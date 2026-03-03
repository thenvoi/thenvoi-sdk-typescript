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

export type ContactEventStrategy = "disabled" | "callback" | "hub_room";

export type ContactEventCallback = (
  event: import("../platform/events").ContactEvent,
  tools: AdapterToolsProtocol,
) => Promise<void>;

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
  participants: Array<Record<string, unknown>>;
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
