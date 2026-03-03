import type { Preprocessor, PreprocessorContext } from "../../contracts/protocols";
import { HistoryProvider, type AgentInput, type PlatformMessage } from "../types";
import type { PlatformEvent } from "../../platform/events";

function toPlatformMessage(roomId: string, payload: {
  id: string;
  content: string;
  sender_id: string;
  sender_type: string;
  sender_name?: string | null;
  message_type: string;
  metadata?: Record<string, unknown> | null;
  inserted_at: string;
}): PlatformMessage {
  return {
    id: payload.id,
    roomId,
    content: payload.content,
    senderId: payload.sender_id,
    senderType: payload.sender_type,
    senderName: payload.sender_name ?? null,
    messageType: payload.message_type,
    metadata: (payload.metadata ?? {}) as Record<string, unknown>,
    createdAt: new Date(payload.inserted_at),
  };
}

export class DefaultPreprocessor implements Preprocessor<PlatformEvent> {
  public async process(
    context: PreprocessorContext,
    event: PlatformEvent,
    agentId: string,
  ): Promise<AgentInput | null> {
    if (event.type !== "message_created" || !event.roomId) {
      return null;
    }

    const message = toPlatformMessage(event.roomId, event.payload);

    if (message.senderId === agentId) {
      return null;
    }

    context.recordMessage(message);

    return {
      message,
      tools: context.getTools(),
      history: new HistoryProvider(context.getRawHistory()),
      participantsMessage: context.consumeParticipantsMessage(),
      contactsMessage: context.consumeContactsMessage(),
      isSessionBootstrap: context.consumeBootstrap(),
      roomId: context.roomId,
    };
  }
}
