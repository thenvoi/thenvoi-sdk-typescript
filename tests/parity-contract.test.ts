import { describe, expect, it } from "vitest";

import {
  Agent,
  AgentTools,
  PlatformRuntime,
  RestFacade,
  ThenvoiLink,
  UnsupportedFeatureError,
  type RestApi,
} from "../src/index";

class ContractRestApi implements RestApi {
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
    return { id: "room" };
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
    return { data: [] };
  }
}

describe("sdk contract", () => {
  it("exposes lifecycle methods", () => {
    expect(typeof Agent.prototype.start).toBe("function");
    expect(typeof Agent.prototype.stop).toBe("function");
    expect(typeof Agent.prototype.run).toBe("function");
    expect(typeof Agent.prototype.runForever).toBe("function");

    expect(typeof PlatformRuntime.prototype.initialize).toBe("function");
    expect(typeof PlatformRuntime.prototype.start).toBe("function");
    expect(typeof PlatformRuntime.prototype.stop).toBe("function");

    expect(typeof ThenvoiLink.prototype.markProcessing).toBe("function");
    expect(typeof ThenvoiLink.prototype.markProcessed).toBe("function");
    expect(typeof ThenvoiLink.prototype.markFailed).toBe("function");
  });

  it("throws UnsupportedFeatureError for unavailable endpoints", async () => {
    const tools = new AgentTools({
      roomId: "room-1",
      rest: new RestFacade({ api: new ContractRestApi() }),
      capabilities: {
        contacts: true,
        memory: true,
      },
    });

    await expect(tools.listContacts()).rejects.toBeInstanceOf(UnsupportedFeatureError);
    await expect(tools.listMemories()).rejects.toBeInstanceOf(UnsupportedFeatureError);
  });
});
