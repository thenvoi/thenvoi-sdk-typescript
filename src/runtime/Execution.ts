import type { Logger } from "../core/logger";
import { NoopLogger } from "../core/logger";
import type { ThenvoiLink } from "../platform/ThenvoiLink";
import type { PlatformEvent } from "../platform/events";
import type { PlatformMessage } from "./types";
import type { ExecutionContext } from "./ExecutionContext";

interface ExecutionOptions {
  roomId: string;
  link: ThenvoiLink;
  context: ExecutionContext;
  onExecute: (context: ExecutionContext, event: PlatformEvent) => Promise<void>;
  onFailure?: (error: unknown, event: PlatformEvent) => void | Promise<void>;
  logger?: Logger;
}

function toMessageEvent(message: PlatformMessage): PlatformEvent {
  const insertedAt = message.createdAt.toISOString();

  return {
    type: "message_created",
    roomId: message.roomId,
    payload: {
      id: message.id,
      content: message.content,
      sender_id: message.senderId,
      sender_type: message.senderType,
      sender_name: message.senderName ?? null,
      message_type: message.messageType,
      metadata: message.metadata,
      inserted_at: insertedAt,
      updated_at: insertedAt,
    },
  };
}

export class Execution {
  private readonly roomId: string;
  private readonly link: ThenvoiLink;
  private readonly context: ExecutionContext;
  private readonly onExecute: (context: ExecutionContext, event: PlatformEvent) => Promise<void>;
  private readonly onFailure?: (error: unknown, event: PlatformEvent) => void | Promise<void>;
  private readonly logger: Logger;
  private readonly eventQueue: PlatformEvent[] = [];
  private readonly waiters: Array<(event: PlatformEvent | null) => void> = [];
  private readonly idleWaiters = new Set<() => void>();
  private readonly drainedWsMessageIds = new Set<string>();
  private processTask: Promise<void>;
  private firstWsMessageId: string | null = null;
  private syncComplete = false;
  private running = true;
  private inFlight = 0;

  public constructor(options: ExecutionOptions) {
    this.roomId = options.roomId;
    this.link = options.link;
    this.context = options.context;
    this.onExecute = options.onExecute;
    this.onFailure = options.onFailure;
    this.logger = options.logger ?? new NoopLogger();
    this.processTask = this.processLoop();
  }

  public enqueue(event: PlatformEvent): Promise<void> {
    if (event.type === "message_created" && !this.syncComplete && this.firstWsMessageId === null) {
      this.firstWsMessageId = event.payload.id;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(event);
    } else {
      this.eventQueue.push(event);
    }

    return Promise.resolve();
  }

  public isIdle(): boolean {
    return this.syncComplete && this.inFlight === 0 && this.eventQueue.length === 0;
  }

  public async waitForIdle(timeoutMs?: number): Promise<boolean> {
    if (this.isIdle()) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const idleWaiter = (): void => {
        if (settled) {
          return;
        }

        settled = true;
        this.idleWaiters.delete(idleWaiter);
        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
        }
        resolve(true);
      };

      this.idleWaiters.add(idleWaiter);
      if (timeoutMs === undefined) {
        return;
      }

      timeoutHandle = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        this.idleWaiters.delete(idleWaiter);
        resolve(false);
      }, timeoutMs);
    });
  }

  public async stop(timeoutMs?: number): Promise<boolean> {
    const graceful = await this.waitForIdle(timeoutMs);
    this.running = false;
    this.resolveEventWaiters(null);

    if (graceful || timeoutMs === undefined) {
      await this.processTask;
    }

    return graceful;
  }

  public async waitUntilStopped(): Promise<void> {
    await this.processTask;
  }

  private async processLoop(): Promise<void> {
    await this.synchronizeWithNext();

    while (this.running) {
      const event = await this.nextQueuedEvent();
      if (!event) {
        return;
      }

      if (event.type === "message_created" && this.drainedWsMessageIds.has(event.payload.id)) {
        this.drainedWsMessageIds.delete(event.payload.id);
        this.notifyIfIdle();
        continue;
      }

      await this.executeEvent(event);
    }
  }

  private async synchronizeWithNext(): Promise<void> {
    while (this.running) {
      const nextMessage = await this.link.getNextMessage(this.roomId);
      if (!nextMessage) {
        break;
      }

      const isSyncPoint = this.firstWsMessageId !== null && nextMessage.id === this.firstWsMessageId;
      await this.executeEvent(toMessageEvent(nextMessage));

      if (isSyncPoint) {
        this.drainedWsMessageIds.add(nextMessage.id);
        this.firstWsMessageId = null;
        break;
      }
    }

    this.syncComplete = true;
    this.notifyIfIdle();
  }

  private async executeEvent(event: PlatformEvent): Promise<void> {
    this.inFlight += 1;
    this.context.setState("processing");

    try {
      await this.onExecute(this.context, event);
    } catch (error: unknown) {
      if (this.onFailure) {
        await this.onFailure(error, event);
      } else {
        this.logger.error("Execution queue task failed", {
          roomId: this.roomId,
          eventType: event.type,
          error,
        });
      }
      this.running = false;
      this.eventQueue.splice(0, this.eventQueue.length);
      this.resolveEventWaiters(null);
      throw error;
    } finally {
      this.inFlight -= 1;
      this.context.setState("idle");
      this.notifyIfIdle();
    }
  }

  private async nextQueuedEvent(): Promise<PlatformEvent | null> {
    const queued = this.eventQueue.shift();
    if (queued) {
      return queued;
    }

    if (!this.running) {
      return null;
    }

    return new Promise<PlatformEvent | null>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private notifyIfIdle(): void {
    if (!this.isIdle()) {
      return;
    }

    const waiters = [...this.idleWaiters];
    this.idleWaiters.clear();
    for (const waiter of waiters) {
      waiter();
    }
  }

  private resolveEventWaiters(event: PlatformEvent | null): void {
    const waiters = this.waiters.splice(0, this.waiters.length);
    for (const waiter of waiters) {
      waiter(event);
    }
  }
}
