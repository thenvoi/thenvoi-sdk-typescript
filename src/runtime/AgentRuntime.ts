import type { ThenvoiLink } from "../platform/ThenvoiLink";
import type { ContactEvent, PlatformEvent } from "../platform/events";
import { UnsupportedFeatureError } from "../core/errors";
import type { Logger } from "../core/logger";
import { NoopLogger } from "../core/logger";
import { Execution } from "./Execution";
import { ExecutionContext } from "./ExecutionContext";
import type { AgentConfig, SessionConfig } from "./types";

interface AgentRuntimeOptions {
  link: ThenvoiLink;
  agentId: string;
  onExecute: (context: ExecutionContext, event: PlatformEvent) => Promise<void>;
  onSessionCleanup?: (roomId: string) => Promise<void>;
  onContactEvent?: (event: ContactEvent) => Promise<void>;
  sessionConfig?: SessionConfig;
  agentConfig?: AgentConfig;
  logger?: Logger;
}

export class AgentRuntime {
  private readonly link: ThenvoiLink;
  private readonly agentId: string;
  private readonly onExecute: (context: ExecutionContext, event: PlatformEvent) => Promise<void>;
  private readonly onSessionCleanup: (roomId: string) => Promise<void>;
  private readonly onContactEvent?: (event: ContactEvent) => Promise<void>;
  private readonly sessionConfig: Required<SessionConfig>;
  private readonly autoSubscribeExistingRooms: boolean;
  private readonly contexts = new Map<string, ExecutionContext>();
  private readonly executions = new Map<string, Execution>();
  private readonly logger: Logger;
  private running = false;
  private stopping = false;
  private stopController = new AbortController();
  private consumeTask: Promise<void> | null = null;

  public constructor(options: AgentRuntimeOptions) {
    this.link = options.link;
    this.agentId = options.agentId;
    this.onExecute = options.onExecute;
    this.onSessionCleanup = options.onSessionCleanup ?? (async () => undefined);
    this.logger = options.logger ?? new NoopLogger();
    this.onContactEvent = options.onContactEvent;
    this.sessionConfig = {
      enableContextCache: options.sessionConfig?.enableContextCache ?? true,
      contextCacheTtlSeconds: options.sessionConfig?.contextCacheTtlSeconds ?? 300,
      maxContextMessages: options.sessionConfig?.maxContextMessages ?? 100,
      maxMessageRetries: options.sessionConfig?.maxMessageRetries ?? 1,
      enableContextHydration: options.sessionConfig?.enableContextHydration ?? true,
    };
    this.autoSubscribeExistingRooms = options.agentConfig?.autoSubscribeExistingRooms ?? true;
  }

  public async start(): Promise<void> {
    if (this.running) {
      return;
    }

    await this.link.connect();
    await this.link.subscribeAgentRooms();
    await this.subscribeExistingRooms();

    if (this.link.capabilities.contacts) {
      await this.link.subscribeAgentContacts();
    }

    this.running = true;
    this.stopping = false;
    if (!this.stopController.signal.aborted) {
      this.stopController.abort();
    }
    this.stopController = new AbortController();
    this.consumeTask = this.consumeLoop(this.stopController.signal);
  }

  public async stop(timeoutMs?: number): Promise<boolean> {
    if (!this.running || this.stopping) {
      return true;
    }

    this.stopping = true;
    this.running = false;
    this.stopController.abort();
    await this.consumeTask;
    this.consumeTask = null;

    const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
    let graceful = true;

    for (const execution of this.executions.values()) {
      const remaining = deadline === undefined ? undefined : Math.max(0, deadline - Date.now());
      const idle = await execution.waitForIdle(remaining);
      if (!idle) {
        graceful = false;
        break;
      }
    }

    for (const roomId of this.contexts.keys()) {
      await this.onSessionCleanup(roomId);
    }

    this.contexts.clear();
    this.executions.clear();

    if (this.link.capabilities.contacts) {
      await this.link.unsubscribeAgentContacts();
    }

    await this.link.disconnect();
    return graceful;
  }

  public getContext(roomId: string): ExecutionContext | undefined {
    return this.contexts.get(roomId);
  }

  public async waitUntilStopped(): Promise<void> {
    await this.link.runForever(this.stopController.signal);
  }

  public contextsList(): ExecutionContext[] {
    return [...this.contexts.values()];
  }

  private async consumeLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const event = await this.link.nextEvent(signal);
      if (!event) {
        return;
      }
      try {
        await this.handleEvent(event);
      } catch (error) {
        this.logger.error("Error handling platform event", {
          eventType: event.type,
          roomId: event.roomId,
          error,
        });
      }
    }
  }

  private async handleEvent(event: PlatformEvent): Promise<void> {
    switch (event.type) {
      case "room_added":
        if (event.roomId) {
          await this.link.subscribeRoom(event.roomId);
          this.getOrCreateExecution(event.roomId);
        }
        return;
      case "room_removed":
      case "room_deleted":
        if (event.roomId) {
          await this.link.unsubscribeRoom(event.roomId);
          this.contexts.delete(event.roomId);
          this.executions.delete(event.roomId);
          await this.onSessionCleanup(event.roomId);
        }
        return;
      case "participant_added":
        if (event.roomId) {
          const context = this.getOrCreateContext(event.roomId);
          context.addParticipant({
            id: event.payload.id,
            name: event.payload.name,
            type: event.payload.type,
            handle: event.payload.handle,
          });
        }
        return;
      case "participant_removed":
        if (event.roomId) {
          const context = this.getOrCreateContext(event.roomId);
          context.removeParticipant(event.payload.id);
        }
        return;
      case "contact_request_received":
      case "contact_request_updated":
      case "contact_added":
      case "contact_removed":
        await this.onContactEvent?.(event);
        return;
      case "message_created":
        if (!event.roomId) {
          return;
        }

        await this.getOrCreateExecution(event.roomId).enqueue(event);
        return;
      default:
        return;
    }
  }

  public async enqueueEvent(roomId: string, event: PlatformEvent): Promise<void> {
    await this.getOrCreateExecution(roomId).enqueue(event);
  }

  private getOrCreateExecution(roomId: string): Execution {
    const existing = this.executions.get(roomId);
    if (existing) {
      return existing;
    }

    const execution = new Execution({
      context: this.getOrCreateContext(roomId),
      onExecute: this.onExecute,
    });
    this.executions.set(roomId, execution);
    return execution;
  }

  private getOrCreateContext(roomId: string): ExecutionContext {
    const existing = this.contexts.get(roomId);
    if (existing) {
      return existing;
    }

    const context = new ExecutionContext({
      roomId,
      link: this.link,
      maxContextMessages: this.sessionConfig.maxContextMessages,
    });
    this.contexts.set(roomId, context);
    return context;
  }

  private async subscribeExistingRooms(): Promise<void> {
    if (!this.autoSubscribeExistingRooms) {
      return;
    }

    try {
      const rooms = await this.link.rest.listAllChats({
        pageSize: 100,
        maxPages: 100,
      });

      for (const room of rooms) {
        const roomId = room.id;
        if (typeof roomId !== "string" || !roomId) {
          continue;
        }

        await this.link.subscribeRoom(roomId);
        this.getOrCreateExecution(roomId);
      }
    } catch (error) {
      if (error instanceof UnsupportedFeatureError) {
        return;
      }

      throw error;
    }
  }
}
