import type { Logger } from "../core/logger";
import { NoopLogger } from "../core/logger";
import type { ContactEvent, MessageEvent } from "../platform/events";
import type { AdapterToolsProtocol } from "../contracts/protocols";
import type { ChatMessagingRestApi, ChatRoomRestApi } from "../client/rest/types";
import type { ContactEventConfig, ContactEventCallback } from "./types";
import {
  SYNTHETIC_SENDER_TYPE,
  SYNTHETIC_CONTACT_EVENTS_SENDER_ID,
  SYNTHETIC_CONTACT_EVENTS_SENDER_NAME,
} from "./types";

const LRU_MAX_SIZE = 1000;

export const HUB_ROOM_SYSTEM_PROMPT = [
  "You are monitoring contact events for an agent.",
  "When you receive contact event notifications, use your contact tools to take appropriate action.",
  "For contact requests, evaluate them and respond using the respond_contact_request tool.",
  "For new contacts, acknowledge them. For removed contacts, note the change.",
  "Always use the tools available to you — do not just reply with text.",
].join(" ");

interface RequestInfo {
  fromHandle: string;
  fromName: string;
  message: string | null;
}

interface ContactEventHandlerOptions {
  config: ContactEventConfig;
  rest: Pick<ChatMessagingRestApi, "createChatEvent"> & Pick<ChatRoomRestApi, "createChat">;
  logger?: Logger;
  onBroadcast?: (message: string) => void;
  onHubEvent?: (roomId: string, event: MessageEvent) => Promise<void>;
  onHubInit?: (roomId: string, systemPrompt: string) => Promise<void>;
}

export class ContactEventHandler {
  private readonly config: ContactEventConfig;
  private readonly rest: Pick<ChatMessagingRestApi, "createChatEvent"> & Pick<ChatRoomRestApi, "createChat">;
  private readonly logger: Logger;
  private readonly onBroadcast?: (message: string) => void;
  private readonly onHubEvent?: (roomId: string, event: MessageEvent) => Promise<void>;
  private readonly onHubInit?: (roomId: string, systemPrompt: string) => Promise<void>;

  private readonly dedup = new Map<string, true>();
  private readonly dedupOrder: string[] = [];
  private readonly requestCache = new Map<string, RequestInfo>();
  private hubRoomId: string | null = null;

  public constructor(options: ContactEventHandlerOptions) {
    this.config = options.config;
    this.rest = options.rest;
    this.logger = options.logger ?? new NoopLogger();
    this.onBroadcast = options.onBroadcast;
    this.onHubEvent = options.onHubEvent;
    this.onHubInit = options.onHubInit;
  }

  public async handle(event: ContactEvent, tools?: AdapterToolsProtocol): Promise<void> {
    const strategy = this.config.strategy ?? "disabled";

    if (strategy === "disabled") {
      this.logger.debug("Contact event ignored (strategy=disabled)", { type: event.type });
      return;
    }

    const dedupKey = this.buildDedupKey(event);
    if (this.dedup.has(dedupKey)) {
      this.logger.debug("Duplicate contact event skipped", { key: dedupKey });
      return;
    }
    this.recordDedup(dedupKey);

    // Cache request info for enriching updates
    if (event.type === "contact_request_received") {
      this.requestCache.set(event.payload.id, {
        fromHandle: event.payload.from_handle,
        fromName: event.payload.from_name,
        message: event.payload.message ?? null,
      });
    }

    // Broadcast for contact_added and contact_removed
    if (this.config.broadcastChanges && this.onBroadcast) {
      if (event.type === "contact_added" || event.type === "contact_removed") {
        const broadcastMsg = this.formatBroadcast(event);
        this.onBroadcast(broadcastMsg);
      }
    }

    if (strategy === "callback") {
      await this.handleCallback(event, tools);
    } else if (strategy === "hub_room") {
      await this.handleHubRoom(event);
    }
  }

  private async handleCallback(event: ContactEvent, tools?: AdapterToolsProtocol): Promise<void> {
    const callback = (this.config as { onEvent?: ContactEventCallback }).onEvent;
    if (!callback) {
      this.logger.warn("Contact event callback strategy configured but no onEvent callback provided");
      return;
    }

    if (!tools) {
      this.logger.warn("Contact event callback requires tools but none provided");
      return;
    }

    try {
      await callback(event, tools);
    } catch (error) {
      this.logger.error("Contact event callback error", {
        type: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleHubRoom(event: ContactEvent): Promise<void> {
    const hubTaskId = this.config.hubTaskId;
    if (!hubTaskId) {
      this.logger.warn("hub_room strategy requires hubTaskId");
      return;
    }

    // Initialize hub room if needed
    if (!this.hubRoomId) {
      try {
        const result = await this.rest.createChat(hubTaskId);
        this.hubRoomId = result.id;
        this.logger.info("Hub room created for contact events", { roomId: this.hubRoomId });

        if (this.onHubInit) {
          await this.onHubInit(this.hubRoomId, HUB_ROOM_SYSTEM_PROMPT);
        }
      } catch (error) {
        this.logger.error("Failed to create hub room", {
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }

    const formattedMessage = this.formatEventMessage(event);

    // Persist as a task event
    try {
      await this.rest.createChatEvent(this.hubRoomId, {
        content: formattedMessage,
        messageType: "contact_event",
        metadata: { contactEventType: event.type, payload: event.payload },
      });
    } catch (error) {
      this.logger.error("Failed to persist contact event to hub room", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Push synthetic message to hub for LLM processing
    if (this.onHubEvent) {
      const syntheticEvent: MessageEvent = {
        type: "message_created",
        roomId: this.hubRoomId,
        payload: {
          id: `contact-evt-${Date.now()}`,
          content: formattedMessage,
          message_type: "contact_event",
          sender_id: SYNTHETIC_CONTACT_EVENTS_SENDER_ID,
          sender_type: SYNTHETIC_SENDER_TYPE,
          sender_name: SYNTHETIC_CONTACT_EVENTS_SENDER_NAME,
          inserted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      };

      try {
        await this.onHubEvent(this.hubRoomId, syntheticEvent);
      } catch (error) {
        this.logger.error("Failed to push contact event to hub", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  public formatEventMessage(event: ContactEvent): string {
    switch (event.type) {
      case "contact_request_received": {
        const msg = event.payload.message ? ` Message: "${event.payload.message}"` : "";
        return `New contact request from ${event.payload.from_name} (@${event.payload.from_handle}).${msg}`;
      }
      case "contact_request_updated": {
        const cached = this.requestCache.get(event.payload.id);
        if (cached) {
          return `Contact request from ${cached.fromName} (@${cached.fromHandle}) updated to ${event.payload.status}.`;
        }
        // TODO: API fallback for enrichment when REST endpoint is available
        return `Contact request ${event.payload.id} updated to ${event.payload.status}.`;
      }
      case "contact_added":
        return `Contact added: ${event.payload.name} (@${event.payload.handle}), type: ${event.payload.type}.`;
      case "contact_removed":
        return `Contact removed: ${event.payload.id}.`;
      default:
        return "Contact event received.";
    }
  }

  private formatBroadcast(event: ContactEvent): string {
    switch (event.type) {
      case "contact_added":
        return `[System]: Contact added: ${event.payload.name} (@${event.payload.handle}).`;
      case "contact_removed":
        return `[System]: Contact removed: ${event.payload.id}.`;
      default:
        return `[System]: Contact event: ${event.type}.`;
    }
  }

  private buildDedupKey(event: ContactEvent): string {
    const id = event.payload.id;
    if (event.type === "contact_request_updated") {
      return `${event.type}:${id}:${event.payload.status}`;
    }
    return `${event.type}:${id}`;
  }

  private recordDedup(key: string): void {
    this.dedup.set(key, true);
    this.dedupOrder.push(key);

    while (this.dedupOrder.length > LRU_MAX_SIZE) {
      const evicted = this.dedupOrder.shift();
      if (evicted) {
        this.dedup.delete(evicted);
      }
    }
  }
}
