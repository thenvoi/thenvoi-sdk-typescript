import type { HistoryConverter } from "../../contracts/protocols";
import { asNonEmptyString, asRecord } from "../shared/coercion";

import type { GatewaySessionState } from "./types";

export class GatewayHistoryConverter
  implements HistoryConverter<GatewaySessionState>
{
  public convert(raw: Array<Record<string, unknown>>): GatewaySessionState {
    const contextToRoom: Record<string, string> = {};
    const roomParticipants = new Map<string, Set<string>>();

    for (const entry of raw) {
      const metadata = asRecord(entry.metadata);
      const contextId = asNonEmptyString(metadata.gateway_context_id);
      if (contextId) {
        const roomId =
          asNonEmptyString(metadata.gateway_room_id) ??
          asNonEmptyString(entry.room_id) ??
          asNonEmptyString(entry.roomId);
        if (roomId) {
          contextToRoom[contextId] = roomId;
        }
      }

      const senderType = (
        asNonEmptyString(entry.sender_type) ?? asNonEmptyString(entry.senderType) ?? ""
      )
        .trim()
        .toLowerCase();
      const roomId = asNonEmptyString(entry.room_id) ?? asNonEmptyString(entry.roomId);
      const senderId = asNonEmptyString(entry.sender_id) ?? asNonEmptyString(entry.senderId);
      if (senderType !== "agent" || !roomId || !senderId) {
        continue;
      }

      const participants = roomParticipants.get(roomId) ?? new Set<string>();
      participants.add(senderId);
      roomParticipants.set(roomId, participants);
    }

    return {
      contextToRoom,
      roomParticipants: Object.fromEntries(roomParticipants.entries()),
    };
  }
}
