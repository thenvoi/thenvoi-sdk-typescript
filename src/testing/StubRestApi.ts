import type { RestApi } from "../client/rest/types";

/**
 * No-op REST API implementation for local development and examples.
 * Returns sensible defaults for all methods without making real API calls.
 */
export class StubRestApi implements RestApi {
  public async getAgentMe() {
    return { id: "stub-agent", name: "Stub Agent", description: null };
  }

  public async createChatMessage() {
    return { ok: true };
  }

  public async createChatEvent() {
    return { ok: true };
  }

  public async createChat() {
    return { id: "stub-room" };
  }

  public async listChatParticipants() {
    return [];
  }

  public async addChatParticipant() {
    return { ok: true };
  }

  public async removeChatParticipant() {
    return { ok: true };
  }

  public async markMessageProcessing() {
    return { ok: true };
  }

  public async markMessageProcessed() {
    return { ok: true };
  }

  public async markMessageFailed() {
    return { ok: true };
  }

  public async listPeers() {
    return {
      data: [],
      metadata: { page: 1, pageSize: 100, totalCount: 0, totalPages: 1 },
    };
  }
}
