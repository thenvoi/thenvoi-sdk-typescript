import type { HistoryConverter } from "../contracts/protocols";

export interface ACPServerSessionState {
  sessionToRoom: Record<string, string>;
  sessionCwd: Record<string, string>;
  sessionMcpServers: Record<string, Array<Record<string, unknown>>>;
}

export class ACPServerHistoryConverter implements HistoryConverter<ACPServerSessionState> {
  public convert(raw: Array<Record<string, unknown>>): ACPServerSessionState {
    const sessionToRoom: Record<string, string> = {};
    const sessionCwd: Record<string, string> = {};
    const sessionMcpServers: Record<string, Array<Record<string, unknown>>> = {};

    for (const entry of raw) {
      const metadataRaw = entry.metadata;
      if (!metadataRaw || typeof metadataRaw !== "object" || Array.isArray(metadataRaw)) {
        continue;
      }
      const metadata = metadataRaw as Record<string, unknown>;

      const sessionId = metadata.acp_session_id;
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        continue;
      }

      const roomId = typeof metadata.acp_room_id === "string"
        ? metadata.acp_room_id
        : (typeof entry.room_id === "string" ? entry.room_id : null);
      if (roomId) {
        sessionToRoom[sessionId] = roomId;
      }

      if (typeof metadata.acp_cwd === "string" && metadata.acp_cwd.length > 0) {
        sessionCwd[sessionId] = metadata.acp_cwd;
      }

      if (Array.isArray(metadata.acp_mcp_servers)) {
        sessionMcpServers[sessionId] = metadata.acp_mcp_servers
          .filter((server: unknown): server is Record<string, unknown> => !!server && typeof server === "object" && !Array.isArray(server));
      }
    }

    return {
      sessionToRoom,
      sessionCwd,
      sessionMcpServers,
    };
  }
}
