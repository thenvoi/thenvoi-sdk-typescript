import type { Logger } from "../core/logger";
import { NoopLogger } from "../core/logger";
import type { ContactEvent, MessageEvent } from "../platform/events";
import type { AdapterToolsProtocol } from "../contracts/protocols";
import type { ChatMessagingRestApi, ChatRoomRestApi } from "../client/rest/types";
import type { ContactEventConfig } from "./types";
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

type ContactEventFailureStage = "callback" | "hub_room_init" | "hub_room_persist" | "hub_room_dispatch";

export class ContactEventHandlerError extends Error {
  public readonly retryable: boolean;
  public readonly stage: ContactEventFailureStage;
  public readonly eventType: ContactEvent["type"];

  public constructor(input: {
    eventType: ContactEvent["type"];
    stage: ContactEventFailureStage;
    retryable: boolean;
    cause: unknown;
  }) {
    super(`Contact event ${input.eventType} failed during ${input.stage}`, { cause: input.cause });
    this.name = "ContactEventHandlerError";
    this.retryable = input.retryable;
    this.stage = input.stage;
    this.eventType = input.eventType;
  }
}

export class ContactEventHandler {
  private readonly config: ContactEventConfig;
  private readonly rest: Pick<ChatMessagingRestApi, "createChatEvent"> & Pick<ChatRoomRestApi, "createChat">;
  private readonly logger: Logger;
  private readonly onBroadcast?: (message: string) => void;
  private readonly onHubEvent?: (roomId: string, event: MessageEvent) => Promise<void>;
  private readonly onHubInit?: (roomId: string, systemPrompt: string) => Promise<void>;

  private readonly dedup = new Set<string>();
  private readonly dedupOrder: string[] = [];
  private syntheticIdCounter = 0;
  private readonly requestCache = new Map<string, RequestInfo>();
  private hubRoomId: string | null = null;
  private hubRoomInitPromise: Promise<string> | null = null;

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

    const dedupKey = this.buildDedupKey(event);
    if (this.dedup.has(dedupKey)) {
      this.logger.debug("Duplicate contact event skipped", { key: dedupKey });
      return;
    }
    this.recordDedup(dedupKey);

    try {
      // Cache request info for enriching updates
      if (event.type === "contact_request_received") {
        this.cacheRequestInfo(event.payload.id, {
          fromHandle: event.payload.from_handle,
          fromName: event.payload.from_name,
          message: event.payload.message ?? null,
        });
      }

      // Broadcast runs regardless of strategy
      if (this.config.broadcastChanges && this.onBroadcast) {
        this.onBroadcast(this.formatBroadcast(event));
      }

      if (strategy === "disabled") {
        return;
      }

      if (strategy === "callback") {
        await this.handleCallback(event, tools);
      } else if (strategy === "hub_room") {
        await this.handleHubRoom(event);
      }
    } catch (error) {
      this.rollbackDedup(dedupKey);
      throw error;
    }
  }

  private async handleCallback(event: ContactEvent, tools?: AdapterToolsProtocol): Promise<void> {
    const callback = this.config.onEvent;
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
      const failure = this.buildHandlerError(event, "callback", error, false);
      this.logFailure(event, failure.stage, failure.retryable, error);
      throw failure;
    }
  }

  private async handleHubRoom(event: ContactEvent): Promise<void> {
    const hubTaskId = this.config.hubTaskId;
    if (!hubTaskId) {
      this.logger.warn("hub_room strategy requires hubTaskId");
      return;
    }

    // Initialize hub room if needed — use promise lock to prevent concurrent creation.
    if (!this.hubRoomId) {
      if (!this.hubRoomInitPromise) {
        this.hubRoomInitPromise = this.initHubRoom(hubTaskId);
      }
      try {
        this.hubRoomId = await this.hubRoomInitPromise;
      } catch (error) {
        this.hubRoomInitPromise = null;
        const failure = this.buildHandlerError(event, "hub_room_init", error, true);
        this.logFailure(event, failure.stage, failure.retryable, error);
        throw failure;
      }
    }

    const formattedMessage = this.formatEventMessage(event);
    let persistFailure: ContactEventHandlerError | null = null;

    // Persist as a task event
    try {
      await this.rest.createChatEvent(this.hubRoomId, {
        content: formattedMessage,
        messageType: "contact_event",
        metadata: { contactEventType: event.type, payload: event.payload },
      });
    } catch (error) {
      persistFailure = this.buildHandlerError(event, "hub_room_persist", error, true);
      this.logFailure(event, persistFailure.stage, persistFailure.retryable, error);
    }

    // Push synthetic message to hub for LLM processing
    let dispatchFailure: ContactEventHandlerError | null = null;
    if (this.onHubEvent) {
      const now = new Date().toISOString();
      const syntheticEvent: MessageEvent = {
        type: "message_created",
        roomId: this.hubRoomId,
        payload: {
          id: `contact-evt-${Date.now()}-${this.syntheticIdCounter++}`,
          content: formattedMessage,
          message_type: "contact_event",
          sender_id: SYNTHETIC_CONTACT_EVENTS_SENDER_ID,
          sender_type: SYNTHETIC_SENDER_TYPE,
          sender_name: SYNTHETIC_CONTACT_EVENTS_SENDER_NAME,
          inserted_at: now,
          updated_at: now,
        },
      };

      try {
        await this.onHubEvent(this.hubRoomId, syntheticEvent);
      } catch (error) {
        dispatchFailure = this.buildHandlerError(event, "hub_room_dispatch", error, true);
        this.logFailure(event, dispatchFailure.stage, dispatchFailure.retryable, error);
      }
    }

    if (persistFailure) {
      throw persistFailure;
    }

    if (dispatchFailure) {
      throw dispatchFailure;
    }
  }

  private async initHubRoom(hubTaskId: string): Promise<string> {
    const result = await this.rest.createChat(hubTaskId);
    this.logger.info("Hub room created for contact events", { roomId: result.id });

    if (this.onHubInit) {
      await this.onHubInit(result.id, HUB_ROOM_SYSTEM_PROMPT);
    }

    return result.id;
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
        return `Contact request ${event.payload.id} updated to ${event.payload.status}.`;
      }
      case "contact_added":
        return `Contact added: ${event.payload.name} (@${event.payload.handle}), type: ${event.payload.type}.`;
      case "contact_removed":
        return `Contact removed: ${event.payload.id}.`;
    }

    return assertNever(event);
  }

  private formatBroadcast(event: ContactEvent): string {
    switch (event.type) {
      case "contact_request_received":
        return `[Contacts]: New contact request from ${event.payload.from_name} (${event.payload.from_handle}).`;
      case "contact_request_updated":
        return `[Contacts]: Contact request ${event.payload.id} updated to ${event.payload.status}.`;
      case "contact_added": {
        const handle = event.payload.handle?.startsWith("@")
          ? event.payload.handle
          : `@${event.payload.handle}`;
        return `[Contacts]: ${handle} (${event.payload.name}) is now a contact`;
      }
      case "contact_removed":
        return `[Contacts]: Contact ${event.payload.id} was removed`;
    }

    return assertNever(event);
  }

  private cacheRequestInfo(id: string, info: RequestInfo): void {
    this.requestCache.set(id, info);
    while (this.requestCache.size > LRU_MAX_SIZE) {
      const first = this.requestCache.keys().next();
      if (first.done) break;
      this.requestCache.delete(first.value);
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
    this.dedup.add(key);
    this.dedupOrder.push(key);

    while (this.dedupOrder.length > LRU_MAX_SIZE) {
      const evicted = this.dedupOrder.shift();
      if (evicted) {
        this.dedup.delete(evicted);
      }
    }
  }

  private rollbackDedup(key: string): void {
    if (!this.dedup.delete(key)) {
      return;
    }

    const index = this.dedupOrder.lastIndexOf(key);
    if (index >= 0) {
      this.dedupOrder.splice(index, 1);
    }
  }

  private buildHandlerError(
    event: ContactEvent,
    stage: ContactEventFailureStage,
    cause: unknown,
    defaultRetryable: boolean,
  ): ContactEventHandlerError {
    return new ContactEventHandlerError({
      eventType: event.type,
      stage,
      retryable: this.resolveRetryable(cause, defaultRetryable),
      cause,
    });
  }

  private resolveRetryable(error: unknown, defaultRetryable: boolean): boolean {
    if (typeof error === "object" && error !== null && "retryable" in error) {
      return (error as { retryable?: unknown }).retryable === true;
    }

    return defaultRetryable;
  }

  private logFailure(
    event: ContactEvent,
    stage: ContactEventFailureStage,
    retryable: boolean,
    error: unknown,
  ): void {
    this.logger.error("contact_event.failure", {
      type: event.type,
      stage,
      retryable,
      error: this.serializeError(error),
    });
  }

  private serializeError(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
      const payload: Record<string, unknown> = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };

      if (typeof (error as { retryable?: unknown }).retryable !== "undefined") {
        payload.retryable = (error as { retryable?: unknown }).retryable;
      }

      return payload;
    }

    return { message: String(error) };
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled contact event: ${JSON.stringify(value)}`);
}
