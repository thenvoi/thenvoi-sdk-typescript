import type { HistoryConverter } from "../contracts/protocols";

export interface ACPClientSessionState {
  roomToSession: Record<string, string>;
}

export class ACPClientHistoryConverter implements HistoryConverter<ACPClientSessionState> {
  public convert(raw: Array<Record<string, unknown>>): ACPClientSessionState {
    const roomToSession: Record<string, string> = {};

    for (const entry of raw) {
      const metadataRaw = entry.metadata;
      if (!metadataRaw || typeof metadataRaw !== "object" || Array.isArray(metadataRaw)) {
        continue;
      }
      const metadata = metadataRaw as Record<string, unknown>;

      const sessionId = metadata.acp_client_session_id;
      const roomId = metadata.acp_client_room_id;
      if (typeof sessionId === "string" && typeof roomId === "string" && sessionId && roomId) {
        roomToSession[roomId] = sessionId;
      }
    }

    return { roomToSession };
  }
}
