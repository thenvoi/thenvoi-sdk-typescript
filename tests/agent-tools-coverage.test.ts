import { describe, expect, it, vi } from "vitest";

import { RestFacade } from "../src/client/rest/RestFacade";
import type { RestApi } from "../src/client/rest/types";
import { UnsupportedFeatureError } from "../src/core/errors";
import { AgentTools } from "../src/runtime/tools/AgentTools";

class CoverageRestApi implements RestApi {
  public readonly createChatMessage = vi.fn(async () => ({ ok: true }));
  public readonly addChatParticipant = vi.fn(async () => ({ ok: true }));
  public readonly listPeers = vi.fn(async ({ page }: { page: number }) => {
    if (page === 1) {
      return {
        data: [{ id: "peer-1", name: "Not It", type: "Agent", handle: "@peer/not-it" }],
        metadata: { page: 1, pageSize: 100, totalCount: 2, totalPages: 2 },
      };
    }

    return {
      data: [{ id: "peer-2", name: "Target Agent", type: "Agent", handle: "@peer/target" }],
      metadata: { page: 2, pageSize: 100, totalCount: 2, totalPages: 2 },
    };
  });

  public async getAgentMe() {
    return { id: "agent-1", name: "Agent", description: null };
  }

  public async createChatEvent() {
    return { ok: true };
  }

  public async createChat() {
    return { id: "room-2" };
  }

  public async listChatParticipants() {
    return [];
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
}

describe("AgentTools coverage", () => {
  it("exposes optional adapter methods only for enabled capabilities", () => {
    const tools = new AgentTools({
      roomId: "room-1",
      rest: new RestFacade({ api: new CoverageRestApi() }),
      capabilities: {
        peers: true,
        contacts: false,
        memory: false,
      },
    });

    const adapterTools = tools.getAdapterTools() as Record<string, unknown>;
    expect(typeof adapterTools.lookupPeers).toBe("function");
    expect(adapterTools.listContacts).toBeUndefined();
    expect(adapterTools.listMemories).toBeUndefined();
  });

  it("paginates peer lookup when adding a participant by name", async () => {
    const rest = new CoverageRestApi();
    const tools = new AgentTools({
      roomId: "room-1",
      rest: new RestFacade({ api: rest }),
      capabilities: {
        peers: true,
      },
    });

    await expect(tools.addParticipant("Target Agent")).resolves.toMatchObject({
      id: "peer-2",
      name: "Target Agent",
      status: "added",
    });
    expect(rest.listPeers).toHaveBeenCalledTimes(2);
    expect(rest.addChatParticipant).toHaveBeenCalledWith(
      "room-1",
      { participantId: "peer-2", role: "member" },
      expect.any(Object),
    );
  });

  it("returns a structured validation error for invalid memory tool arguments", async () => {
    const tools = new AgentTools({
      roomId: "room-1",
      rest: new RestFacade({ api: new CoverageRestApi() }),
      capabilities: {
        memory: true,
      },
    });

    const result = await tools.executeToolCall("thenvoi_store_memory", {
      content: "remember this",
      thought: "reasoning",
      system: "bad-system",
      type: "bad-type",
      segment: "bad-segment",
    });

    expect(result).toMatchObject({
      ok: false,
      errorType: "ToolArgumentsValidationError",
      toolName: "thenvoi_store_memory",
      details: {
        validationErrors: expect.arrayContaining([
          expect.stringContaining("system: Invalid value 'bad-system'"),
          expect.stringContaining("type: Invalid value 'bad-type'"),
          expect.stringContaining("segment: Invalid value 'bad-segment'"),
        ]),
      },
    });
  });

  it("returns a structured execution error when a tool fails after validation passes", async () => {
    const tools = new AgentTools({
      roomId: "room-1",
      rest: new RestFacade({ api: new CoverageRestApi() }),
      capabilities: {
        peers: false,
      },
    });

    const result = await tools.executeToolCall("thenvoi_lookup_peers", {});

    expect(result).toMatchObject({
      ok: false,
      errorType: "ToolExecutionError",
      toolName: "thenvoi_lookup_peers",
    });
  });

  it("throws when peer lookup capability is enabled but the adapter does not support the endpoint", async () => {
    const tools = new AgentTools({
      roomId: "room-1",
      rest: new RestFacade({
        api: {
          async getAgentMe() {
            return { id: "agent-1", name: "Agent", description: null };
          },
          async createChatMessage() {
            return {};
          },
          async createChatEvent() {
            return {};
          },
          async createChat() {
            return { id: "room-2" };
          },
          async listChatParticipants() {
            return [];
          },
          async addChatParticipant() {
            return {};
          },
          async removeChatParticipant() {
            return {};
          },
          async markMessageProcessing() {
            return {};
          },
          async markMessageProcessed() {
            return {};
          },
          async markMessageFailed() {
            return {};
          },
        },
      }),
      capabilities: {
        peers: true,
      },
    });

    await expect(tools.lookupPeers()).rejects.toBeInstanceOf(UnsupportedFeatureError);
  });

  it("returns a structured validation error when contact tool selectors are ambiguous", async () => {
    const tools = new AgentTools({
      roomId: "room-1",
      rest: new RestFacade({ api: new CoverageRestApi() }),
      capabilities: {
        contacts: true,
      },
    });

    const removeResult = await tools.executeToolCall("thenvoi_remove_contact", {
      handle: "@jane",
      contact_id: "contact-1",
    });
    const respondResult = await tools.executeToolCall("thenvoi_respond_contact_request", {
      action: "approve",
      handle: "@jane",
      request_id: "request-1",
    });

    expect(removeResult).toMatchObject({
      ok: false,
      errorType: "ToolArgumentsValidationError",
      toolName: "thenvoi_remove_contact",
    });
    expect(respondResult).toMatchObject({
      ok: false,
      errorType: "ToolArgumentsValidationError",
      toolName: "thenvoi_respond_contact_request",
    });
  });

  it("includes memory tools in schemas only when memory is enabled and requested", () => {
    const toolsWithoutMemory = new AgentTools({
      roomId: "room-1",
      rest: new RestFacade({ api: new CoverageRestApi() }),
      capabilities: {
        memory: false,
      },
    });
    const toolsWithMemory = new AgentTools({
      roomId: "room-1",
      rest: new RestFacade({ api: new CoverageRestApi() }),
      capabilities: {
        memory: true,
      },
    });

    const withoutMemory = toolsWithoutMemory.getToolSchemas("openai", { includeMemory: true });
    const withMemory = toolsWithMemory.getToolSchemas("openai", { includeMemory: true });

    expect(withoutMemory.some((entry) =>
      (entry.function as { name?: string } | undefined)?.name === "thenvoi_store_memory"
    )).toBe(false);
    expect(withMemory.some((entry) =>
      (entry.function as { name?: string } | undefined)?.name === "thenvoi_store_memory"
    )).toBe(true);
  });
});
