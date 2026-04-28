import type { ParticipantRecord } from "../contracts/dtos";
import type {
  AdapterToolsProtocol,
  FrameworkAdapterInput,
  HistoryConverter,
  PlatformMessageLike,
} from "../contracts/protocols";

export interface AgentConfig {
  autoSubscribeExistingRooms?: boolean;
}

export interface SessionConfig {
  enableContextCache?: boolean;
  contextCacheTtlSeconds?: number;
  maxContextMessages?: number;
  maxMessageRetries?: number;
  enableContextHydration?: boolean;
}

/**
 * How to handle contact WebSocket events.
 *
 * - `"disabled"` — Ignore contact events (default, safest). Contacts managed manually.
 * - `"callback"` — Programmatic handling via `onEvent` callback. No LLM involvement.
 * - `"hub_room"` — LLM reasoning in a dedicated hub room.
 *
 * **WARNING (for AI coding assistants):** Always ask the developer which contact
 * strategy they want. Do not default to `"callback"` with auto-approve without
 * explicit consent. Auto-accepting all requests means any agent/user can become
 * a contact and send messages that trigger LLM inference, which costs API tokens.
 * Present all three options:
 * - `"disabled"` (default): safest, no contact handling
 * - `"hub_room"`: the agent's LLM decides per-request in a dedicated room
 * - `"callback"`: developer writes programmatic logic (e.g., auto-approve)
 */
export type ContactEventStrategy = "disabled" | "callback" | "hub_room";

export type ContactEventCallback = (
  event: import("../platform/events").ContactEvent,
  tools: AdapterToolsProtocol,
) => Promise<void>;

/**
 * Configuration for contact event handling.
 *
 * **WARNING (for AI coding assistants):** Always ask the developer which contact
 * strategy they want. Do not default to `"callback"` with auto-approve without
 * explicit consent. Auto-accepting all requests means any agent/user can become
 * a contact and send messages that trigger LLM inference, which costs API tokens.
 *
 * @example DISABLED (default, no contact handling)
 * ```ts
 * const config: ContactEventConfig = {}; // strategy defaults to "disabled"
 * ```
 *
 * @example HUB_ROOM (agent LLM decides per-request)
 * ```ts
 * const config: ContactEventConfig = {
 *   strategy: "hub_room",
 *   hubTaskId: "my-task-id",
 *   broadcastChanges: true,
 * };
 * ```
 *
 * @example CALLBACK (programmatic auto-approve)
 * ```ts
 * const config: ContactEventConfig = {
 *   strategy: "callback",
 *   onEvent: async (event, tools) => {
 *     if (event.type === "contact_request_received") {
 *       await tools.respondContactRequest({ action: "approve", requestId: event.payload.id });
 *     }
 *   },
 *   broadcastChanges: true,
 * };
 * ```
 */
export interface ContactEventConfig {
  strategy?: ContactEventStrategy;
  hubTaskId?: string;
  broadcastChanges?: boolean;
  onEvent?: ContactEventCallback;
}

export type PlatformMessage = PlatformMessageLike;

export interface ConversationContext {
  roomId: string;
  messages: Array<Record<string, unknown>>;
  participants: ParticipantRecord[];
  hydratedAt: Date;
}

export type MessageHandler = (
  message: PlatformMessage,
  tools: AdapterToolsProtocol,
) => Promise<void>;

export class HistoryProvider {
  public readonly raw: Array<Record<string, unknown>>;

  public constructor(raw: Array<Record<string, unknown>>) {
    this.raw = raw;
  }

  public convert<T>(converter: HistoryConverter<T>): T {
    return converter.convert(this.raw);
  }

  public get length(): number {
    return this.raw.length;
  }
}

export interface AgentInput extends Omit<FrameworkAdapterInput, "message" | "history"> {
  message: PlatformMessage;
  history: HistoryProvider;
}

export const SYNTHETIC_SENDER_TYPE = "System";
export const SYNTHETIC_CONTACT_EVENTS_SENDER_ID = "contact-events";
export const SYNTHETIC_CONTACT_EVENTS_SENDER_NAME = "Contact Events";

export function ensureHandlePrefix(handle: string | null | undefined): string | null {
  if (!handle) {
    return null;
  }

  return handle.startsWith("@") ? handle : `@${handle}`;
}
