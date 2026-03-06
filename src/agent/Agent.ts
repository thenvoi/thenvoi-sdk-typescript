import type { FrameworkAdapter } from "../contracts/protocols";
import type { AgentCredentials } from "../config";
import { PlatformRuntime, type PlatformRuntimeOptions } from "../runtime/PlatformRuntime";
import { GracefulShutdown } from "../runtime/shutdown";

export interface AgentCreateOptions extends Omit<PlatformRuntimeOptions, "agentId" | "apiKey" | "wsUrl" | "restUrl"> {
  adapter: FrameworkAdapter;
  config?: AgentCredentials;
  agentId?: string;
  apiKey?: string;
  wsUrl?: string;
  restUrl?: string;
  shutdownTimeoutMs?: number | null;
}

export class Agent {
  private readonly platformRuntime: PlatformRuntime;
  private readonly adapter: FrameworkAdapter;
  private started = false;
  private startPromise: Promise<void> | null = null;
  private shutdownTimeoutMs: number | null = 30_000;

  public constructor(runtime: PlatformRuntime, adapter: FrameworkAdapter) {
    this.platformRuntime = runtime;
    this.adapter = adapter;
  }

  public static create(options: AgentCreateOptions): Agent {
    const {
      adapter,
      config,
      agentId,
      apiKey,
      wsUrl,
      restUrl,
      shutdownTimeoutMs,
      ...runtimeOptions
    } = options;
    const runtime = new PlatformRuntime({
      ...runtimeOptions,
      agentId: agentId ?? config?.agentId ?? "",
      apiKey: apiKey ?? config?.apiKey ?? "",
      ...(wsUrl !== undefined || config?.wsUrl !== undefined
        ? { wsUrl: wsUrl ?? config?.wsUrl }
        : {}),
      ...(restUrl !== undefined || config?.restUrl !== undefined
        ? { restUrl: restUrl ?? config?.restUrl }
        : {}),
    });
    const agent = new Agent(runtime, adapter);
    agent.shutdownTimeoutMs = shutdownTimeoutMs ?? 30_000;
    return agent;
  }

  public get isRunning(): boolean {
    return this.started;
  }

  public get runtime(): PlatformRuntime {
    return this.platformRuntime;
  }

  public get agentName(): string {
    return this.platformRuntime.name;
  }

  public get agentDescription(): string {
    return this.platformRuntime.description;
  }

  public get contactConfig() {
    return this.platformRuntime.contactConfiguration;
  }

  public get isContactsSubscribed(): boolean {
    return this.platformRuntime.isContactsSubscribed;
  }

  public async start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.platformRuntime.start(this.adapter).then(() => {
      this.started = true;
    }).catch((error) => {
      this.startPromise = null;
      throw error;
    });
    return this.startPromise;
  }

  public async stop(timeoutMs?: number | null): Promise<boolean> {
    if (!this.started) {
      return true;
    }

    try {
      const graceful = await this.platformRuntime.stop(timeoutMs ?? undefined);
      await this.adapter.onRuntimeStop?.();
      return graceful;
    } finally {
      this.started = false;
      this.startPromise = null;
    }
  }

  public async runForever(): Promise<void> {
    await this.platformRuntime.runForever();
  }

  public async run(options?: {
    shutdownTimeoutMs?: number | null;
    signals?: boolean;
  }): Promise<void> {
    if (options?.shutdownTimeoutMs !== undefined) {
      this.shutdownTimeoutMs = options.shutdownTimeoutMs;
    }

    const useSignals = options?.signals ?? true;

    if (useSignals) {
      const shutdown = new GracefulShutdown(this, {
        timeoutMs: this.shutdownTimeoutMs ?? 30_000,
      });
      await shutdown.withSignals(async () => {
        await this.start();
        try {
          await this.runForever();
        } finally {
          await this.stop(this.shutdownTimeoutMs);
        }
      });
    } else {
      await this.start();
      try {
        await this.runForever();
      } finally {
        await this.stop(this.shutdownTimeoutMs);
      }
    }
  }

  public async withLifecycle<T>(handler: (agent: Agent) => Promise<T>): Promise<T> {
    await this.start();
    try {
      return await handler(this);
    } finally {
      await this.stop(this.shutdownTimeoutMs);
    }
  }
}
