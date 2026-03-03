import { describe, expect, it } from "vitest";

import { RestFacade } from "../src/client/rest/RestFacade";
import type { RestApi } from "../src/client/rest/types";
import { UnsupportedFeatureError, ValidationError } from "../src/core/errors";
import { AgentTools } from "../src/runtime/tools/AgentTools";

class FakeRestApi implements RestApi {
  public readonly addedParticipants: Array<{ chatId: string; participantId: string; role: string }> = [];

  public async getAgentMe() {
    return { id: "a1", name: "Agent", description: "desc" };
  }

  public async createChatMessage() {
    return { ok: true };
  }

  public async createChatEvent() {
    return { ok: true };
  }

  public async createChat() {
    return { id: "r2" };
  }

  public async listChatParticipants() {
    return [
      { id: "u1", name: "Jane", type: "User", handle: "@jane" },
      { id: "u2", name: "John", type: "User", handle: "@john" },
    ];
  }

  public async addChatParticipant(
    chatId: string,
    participant: { participantId: string; role: string },
  ) {
    this.addedParticipants.push({
      chatId,
      participantId: participant.participantId,
      role: participant.role,
    });
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

  public async listPeers(request: { page: number; pageSize: number }) {
    if (request.page === 1) {
      return {
        data: [{ id: "p0", name: "First", type: "Agent", handle: "@sam/first" }],
        metadata: { page: 1, pageSize: 100, totalCount: 2, totalPages: 2 },
      };
    }

    return {
      data: [{ id: "p1", name: "Weather", type: "Agent", handle: "@sam/weather" }],
      metadata: { page: 2, pageSize: 100, totalCount: 2, totalPages: 2 },
    };
  }
}

describe("AgentTools", () => {
  it("sends messages with resolved mentions", async () => {
    const tools = new AgentTools({
      roomId: "room-1",
      rest: new RestFacade({ api: new FakeRestApi() }),
      participants: [{ id: "u1", handle: "@jane", name: "Jane", type: "User" }],
    });

    const result = await tools.sendMessage("hi", ["@jane"]);
    expect(result).toEqual({ ok: true });

    const resultNoAt = await tools.sendMessage("hi", ["jane"]);
    expect(resultNoAt).toEqual({ ok: true });
  });

  it("gates peers endpoint when disabled", async () => {
    const tools = new AgentTools({
      roomId: "room-1",
      rest: new RestFacade({ api: new FakeRestApi() }),
      capabilities: { peers: false },
    });

    await expect(tools.lookupPeers()).rejects.toBeInstanceOf(UnsupportedFeatureError);
  });

  it("includes lookup tool schema only when peers enabled", () => {
    const tools = new AgentTools({
      roomId: "room-1",
      rest: new RestFacade({ api: new FakeRestApi() }),
      capabilities: { peers: false },
    });

    const schemas = tools.getToolSchemas("openai");
    const hasLookup = schemas.some(
      (entry) => (entry.function as { name?: string } | undefined)?.name === "thenvoi_lookup_peers",
    );
    expect(hasLookup).toBe(false);
  });

  it("validates event message type", async () => {
    const tools = new AgentTools({
      roomId: "room-1",
      rest: new RestFacade({ api: new FakeRestApi() }),
    });

    await expect(tools.sendEvent("hello", "message_created")).rejects.toBeInstanceOf(ValidationError);
  });

  it("looks up peers across paginated pages when adding participant", async () => {
    const api = new FakeRestApi();
    const tools = new AgentTools({
      roomId: "room-1",
      rest: new RestFacade({ api }),
      capabilities: { peers: true },
    });

    const result = await tools.addParticipant("Weather");
    expect(result).toMatchObject({ id: "p1", name: "Weather", status: "added" });
    expect(api.addedParticipants).toEqual([
      { chatId: "room-1", participantId: "p1", role: "member" },
    ]);
  });
});
