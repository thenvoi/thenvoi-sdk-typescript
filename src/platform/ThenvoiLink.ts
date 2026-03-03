import { ValidationError } from "../core/errors";
import type { Logger } from "../core/logger";
import { NoopLogger } from "../core/logger";
import { RestFacade, type RestFacadeOptions } from "../client/rest/RestFacade";
import type { ThenvoiLinkRestApi } from "../client/rest/types";
import type { PlatformEvent } from "./events";
import { assertCapability } from "../runtime/capabilities";
import {
  type SupportedSocketEvent,
  payloadSchemas,
} from "./streaming/payloadSchemas";
import { PhoenixChannelsTransport } from "./streaming/PhoenixChannelsTransport";
import type { StreamingTransport } from "./streaming/transport";
import {
  DEFAULT_AGENT_TOOLS_CAPABILITIES,
  type AgentToolsCapabilities,
} from "../contracts/protocols";

export interface ThenvoiLinkOptions {
  agentId: string;
  apiKey: string;
  wsUrl?: string;
  restUrl?: string;
  restApi: ThenvoiLinkRestApi;
  transport?: StreamingTransport;
  logger?: Logger;
  capabilities?: Partial<AgentToolsCapabilities>;
}

const DEFAULT_WS_URL = "wss://app.thenvoi.com/api/v1/socket/websocket";

function deriveDefaultRestUrl(wsUrl: string): string {
  const parsed = new URL(wsUrl);
  const protocol = parsed.protocol === "ws:" ? "http:" : "https:";
  return `${protocol}//${parsed.host}`;
}

interface PendingWaiter {
  resolve: (event: PlatformEvent | null) => void;
  cleanup: () => void;
}

export class ThenvoiLink implements AsyncIterable<PlatformEvent> {
  public readonly agentId: string;
  public readonly apiKey: string;
  public readonly wsUrl: string;
  public readonly restUrl: string;
  public readonly rest: RestFacade;
  public readonly capabilities: AgentToolsCapabilities;

  private readonly logger: Logger;
  private readonly transport: StreamingTransport;
  private readonly subscribedRooms = new Set<string>();
  private readonly eventQueue: PlatformEvent[] = [];
  private readonly waiters: PendingWaiter[] = [];
  private connected = false;

  public constructor(options: ThenvoiLinkOptions) {
    this.agentId = options.agentId;
    this.apiKey = options.apiKey;
    this.wsUrl = options.wsUrl ?? DEFAULT_WS_URL;
    this.restUrl = options.restUrl ?? deriveDefaultRestUrl(this.wsUrl);
    this.logger = options.logger ?? new NoopLogger();
    this.capabilities = {
      ...DEFAULT_AGENT_TOOLS_CAPABILITIES,
      ...options.capabilities,
    };

    this.rest = new RestFacade({
      api: options.restApi,
      logger: this.logger,
    } satisfies RestFacadeOptions);

    this.transport =
      options.transport ??
      new PhoenixChannelsTransport({
        wsUrl: this.wsUrl,
        apiKey: this.apiKey,
        agentId: this.agentId,
        logger: this.logger,
      });
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    await this.transport.connect();
    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    for (const roomId of this.subscribedRooms) {
      await this.unsubscribeRoom(roomId);
    }

    await this.transport.disconnect();
    this.connected = false;
  }

  public async runForever(signal?: AbortSignal): Promise<void> {
    await this.transport.runForever(signal);
  }

  public queueEvent(event: PlatformEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(event);
      return;
    }

    this.eventQueue.push(event);
  }

  public async subscribeAgentRooms(): Promise<void> {
    await this.transport.join(`agent_rooms:${this.agentId}`, {
      room_added: (payload) => this.emit("room_added", payload, payload.id as string),
      room_removed: (payload) => this.emit("room_removed", payload, payload.id as string),
    });
  }

  public async subscribeRoom(roomId: string): Promise<void> {
    if (this.subscribedRooms.has(roomId)) {
      return;
    }

    await this.transport.join(`chat_room:${roomId}`, {
      message_created: (payload) => this.emit("message_created", payload, roomId),
    });

    await this.transport.join(`room_participants:${roomId}`, {
      participant_added: (payload) => this.emit("participant_added", payload, roomId),
      participant_removed: (payload) => this.emit("participant_removed", payload, roomId),
      room_deleted: (payload) => this.emit("room_deleted", payload, roomId),
    });

    this.subscribedRooms.add(roomId);
  }

  public async unsubscribeRoom(roomId: string): Promise<void> {
    if (!this.subscribedRooms.has(roomId)) {
      return;
    }

    await this.transport.leave(`chat_room:${roomId}`);
    await this.transport.leave(`room_participants:${roomId}`);
    this.subscribedRooms.delete(roomId);
  }

  public async subscribeAgentContacts(): Promise<void> {
    assertCapability(this.capabilities, "contacts", "Contacts streaming");
    await this.transport.join(`agent_contacts:${this.agentId}`, {
      contact_request_received: (payload) => this.emit("contact_request_received", payload, null),
      contact_request_updated: (payload) => this.emit("contact_request_updated", payload, null),
      contact_added: (payload) => this.emit("contact_added", payload, null),
      contact_removed: (payload) => this.emit("contact_removed", payload, null),
    });
  }

  public async unsubscribeAgentContacts(): Promise<void> {
    await this.transport.leave(`agent_contacts:${this.agentId}`);
  }

  public async nextEvent(signal?: AbortSignal): Promise<PlatformEvent | null> {
    if (signal?.aborted) {
      return null;
    }

    const queued = this.eventQueue.shift();
    if (queued) {
      return queued;
    }

    return new Promise<PlatformEvent | null>((resolve) => {
      let settled = false;
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        finalize(null);
      };
      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
      };
      const finalize = (event: PlatformEvent | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(event);
      };
      const waiter: PendingWaiter = {
        resolve: finalize,
        cleanup,
      };

      this.waiters.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  public [Symbol.asyncIterator](): AsyncIterator<PlatformEvent> {
    return {
      next: async () => ({
        done: false,
        value: (await this.nextEvent()) as PlatformEvent,
      }),
    };
  }

  public async markProcessing(roomId: string, messageId: string): Promise<void> {
    try {
      await this.rest.markMessageProcessing(roomId, messageId);
    } catch {
      // best-effort lifecycle signaling
    }
  }

  public async markProcessed(roomId: string, messageId: string): Promise<void> {
    try {
      await this.rest.markMessageProcessed(roomId, messageId);
    } catch {
      // best-effort lifecycle signaling
    }
  }

  public async markFailed(roomId: string, messageId: string, error: string): Promise<void> {
    try {
      await this.rest.markMessageFailed(roomId, messageId, error.trim() || "Unknown error");
    } catch {
      // best-effort lifecycle signaling
    }
  }

  private emit(eventType: SupportedSocketEvent, payload: Record<string, unknown>, roomId: string | null): void {
    const schema = payloadSchemas[eventType];
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ValidationError(`Invalid ${eventType} payload: ${parsed.error.message}`, parsed.error);
    }

    this.queueEvent({
      type: eventType,
      roomId,
      payload: parsed.data,
      raw: payload,
    } as PlatformEvent);
  }
}
