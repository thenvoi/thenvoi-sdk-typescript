import type { Agent } from "../agent/Agent";

interface GracefulShutdownOptions {
  timeoutMs?: number;
  onSignal?: (signal: NodeJS.Signals) => void;
}

export class GracefulShutdown {
  private readonly agent: Agent;
  private readonly timeoutMs: number;
  private readonly onSignal?: (signal: NodeJS.Signals) => void;
  private readonly handlers = new Map<NodeJS.Signals, () => void>();
  private shuttingDown = false;

  public constructor(agent: Agent, options?: GracefulShutdownOptions) {
    this.agent = agent;
    this.timeoutMs = options?.timeoutMs ?? 30_000;
    this.onSignal = options?.onSignal;
  }

  public registerSignals(): void {
    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
    for (const signal of signals) {
      const handler = () => {
        this.onSignal?.(signal);
        void this.shutdown(signal);
      };
      process.on(signal, handler);
      this.handlers.set(signal, handler);
    }
  }

  public unregisterSignals(): void {
    for (const [signal, handler] of this.handlers.entries()) {
      process.off(signal, handler);
    }
    this.handlers.clear();
  }

  public async withSignals<T>(fn: () => Promise<T>): Promise<T> {
    this.registerSignals();
    try {
      return await fn();
    } finally {
      this.unregisterSignals();
    }
  }

  private async shutdown(_signal: NodeJS.Signals): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;
    await this.agent.stop(this.timeoutMs);
  }
}

export async function runWithGracefulShutdown(
  agent: Agent,
  options?: GracefulShutdownOptions,
): Promise<void> {
  const shutdown = new GracefulShutdown(agent, options);
  await shutdown.withSignals(async () => {
    await agent.run({
      shutdownTimeoutMs: options?.timeoutMs ?? 30_000,
      signals: false,
    });
  });
}
