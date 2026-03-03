import type { FrameworkAdapter, Preprocessor } from "../contracts/protocols";
import type { PlatformEvent } from "../platform/events";
import { PlatformRuntime, type PlatformRuntimeOptions } from "../runtime/PlatformRuntime";

interface AgentCreateOptions extends PlatformRuntimeOptions {
  adapter: FrameworkAdapter;
  preprocessor?: Preprocessor<PlatformEvent>;
  shutdownTimeoutMs?: number | null;
}

export class Agent {
  private readonly platformRuntime: PlatformRuntime;
  private readonly adapter: FrameworkAdapter;
  private started = false;
  private shutdownTimeoutMs: number | null = 30_000;

  public constructor(runtime: PlatformRuntime, adapter: FrameworkAdapter) {
    this.platformRuntime = runtime;
    this.adapter = adapter;
  }

  public static create(options: AgentCreateOptions): Agent {
    const runtime = new PlatformRuntime({
      ...options,
      preprocessor: options.preprocessor,
    });
    const agent = new Agent(runtime, options.adapter);
    agent.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 30_000;
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
    if (this.started) {
      return;
    }

    await this.platformRuntime.start(this.adapter);
    this.started = true;
  }

  public async stop(timeoutMs?: number | null): Promise<boolean> {
    if (!this.started) {
      return true;
    }

    const graceful = await this.platformRuntime.stop(timeoutMs ?? undefined);
    await this.adapter.onRuntimeStop?.();
    this.started = false;
    return graceful;
  }

  public async runForever(): Promise<void> {
    await this.platformRuntime.runForever();
  }

  public async run(options?: { shutdownTimeoutMs?: number | null }): Promise<void> {
    await this.start();
    if (options?.shutdownTimeoutMs !== undefined) {
      this.shutdownTimeoutMs = options.shutdownTimeoutMs;
    }

    try {
      await this.runForever();
    } finally {
      await this.stop(this.shutdownTimeoutMs);
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
