import type { PlatformEvent } from "../platform/events";
import type { ExecutionContext } from "./ExecutionContext";

interface ExecutionOptions {
  context: ExecutionContext;
  onExecute: (context: ExecutionContext, event: PlatformEvent) => Promise<void>;
}

export class Execution {
  private readonly context: ExecutionContext;
  private readonly onExecute: (context: ExecutionContext, event: PlatformEvent) => Promise<void>;
  private queue: Promise<void> = Promise.resolve();
  private inFlight = 0;

  public constructor(options: ExecutionOptions) {
    this.context = options.context;
    this.onExecute = options.onExecute;
  }

  public enqueue(event: PlatformEvent): Promise<void> {
    const run = this.queue.catch(() => undefined).then(async () => {
      this.inFlight += 1;
      this.context.setState("processing");
      try {
        await this.onExecute(this.context, event);
      } finally {
        this.inFlight -= 1;
        this.context.setState("idle");
      }
    });

    this.queue = run.catch(() => undefined);
    return run;
  }

  public isIdle(): boolean {
    return this.inFlight === 0;
  }

  public async waitForIdle(timeoutMs?: number): Promise<boolean> {
    if (timeoutMs === undefined) {
      await this.queue;
      return true;
    }

    const timed = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      void this.queue.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });

    return timed;
  }
}
