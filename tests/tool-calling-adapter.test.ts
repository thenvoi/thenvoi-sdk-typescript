import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  OpenAIAdapter,
  type AgentToolsProtocol,
  type CustomToolDef,
  type HistoryProvider,
  type PlatformMessage,
  type ToolCallingModel,
} from "../src/index";
import type {
  ContactRecord,
  ContactRequestRecord,
  MemoryRecord,
  MetadataMap,
  PaginatedList,
  ParticipantRecord,
  PeerRecord,
} from "../src/contracts/dtos";

class FakeTools implements AgentToolsProtocol {
  public readonly capabilities = { peers: false, contacts: false, memory: false };
  public readonly events: Array<Record<string, unknown>> = [];
  public readonly messages: string[] = [];

  public async sendMessage(content: string): Promise<Record<string, unknown>> {
    this.messages.push(content);
    return { ok: true };
  }

  public async sendEvent(content: string, messageType: string): Promise<Record<string, unknown>> {
    this.events.push({ content, messageType });
    return { ok: true };
  }

  public async addParticipant(): Promise<Record<string, unknown>> {
    return { ok: true };
  }

  public async removeParticipant(): Promise<Record<string, unknown>> {
    return { ok: true };
  }

  public async getParticipants(): Promise<ParticipantRecord[]> {
    return [];
  }

  public async lookupPeers(): Promise<PaginatedList<PeerRecord>> {
    return { data: [] };
  }

  public async createChatroom(): Promise<string> {
    return "room";
  }

  public getToolSchemas(): Array<Record<string, unknown>> {
    return [
      {
        type: "function",
        function: {
          name: "thenvoi_send_message",
          parameters: { type: "object", properties: {} },
        },
      },
    ];
  }

  public getAnthropicToolSchemas(): Array<Record<string, unknown>> {
    return this.getToolSchemas();
  }

  public getOpenAIToolSchemas(): Array<Record<string, unknown>> {
    return this.getToolSchemas();
  }

  public async listContacts(): Promise<PaginatedList<ContactRecord>> {
    throw new Error("not implemented");
  }

  public async addContact(): Promise<Record<string, unknown>> {
    throw new Error("not implemented");
  }

  public async removeContact(): Promise<Record<string, unknown>> {
    throw new Error("not implemented");
  }

  public async listContactRequests(): Promise<PaginatedList<ContactRequestRecord>> {
    throw new Error("not implemented");
  }

  public async respondContactRequest(): Promise<Record<string, unknown>> {
    throw new Error("not implemented");
  }

  public async listMemories(): Promise<PaginatedList<MemoryRecord>> {
    throw new Error("not implemented");
  }

  public async storeMemory(): Promise<Record<string, unknown>> {
    throw new Error("not implemented");
  }

  public async getMemory(): Promise<Record<string, unknown>> {
    throw new Error("not implemented");
  }

  public async supersedeMemory(): Promise<Record<string, unknown>> {
    throw new Error("not implemented");
  }

  public async archiveMemory(): Promise<Record<string, unknown>> {
    throw new Error("not implemented");
  }

  public async executeToolCall(name: string, _arguments: MetadataMap): Promise<unknown> {
    if (name === "thenvoi_send_message") {
      return { ok: true };
    }

    return { ok: true };
  }
}

class FakeModel implements ToolCallingModel {
  private turns = 0;

  public async complete(): Promise<{ text?: string; toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }> }> {
    this.turns += 1;
    if (this.turns === 1) {
      return {
        toolCalls: [
          {
            id: "tc1",
            name: "thenvoi_send_message",
            input: { content: "ignored" },
          },
        ],
      };
    }

    return { text: "final answer" };
  }
}

const fakeHistory = {
  raw: [],
  convert: () => [],
  length: 0,
} as unknown as HistoryProvider;

const fakeMessage: PlatformMessage = {
  id: "m1",
  roomId: "r1",
  content: "hello",
  senderId: "u1",
  senderType: "User",
  senderName: "Jane",
  messageType: "text",
  metadata: {},
  createdAt: new Date(),
};

describe("ToolCallingAdapter", () => {
  it("runs tool rounds then sends final text", async () => {
    const adapter = new OpenAIAdapter({
      model: new FakeModel(),
    });

    const tools = new FakeTools();
    await adapter.onMessage(fakeMessage, tools, fakeHistory, null, null, {
      isSessionBootstrap: true,
      roomId: "r1",
    });

    expect(tools.messages).toEqual(["final answer"]);
  });

  it("emits tool_call and tool_result events when execution reporting is enabled", async () => {
    const adapter = new OpenAIAdapter({
      model: new FakeModel(),
      enableExecutionReporting: true,
    });

    const tools = new FakeTools();
    await adapter.onMessage(fakeMessage, tools, fakeHistory, null, null, {
      isSessionBootstrap: true,
      roomId: "r1",
    });

    expect(tools.events).toHaveLength(2);
    expect(tools.events[0]?.messageType).toBe("tool_call");
    expect(tools.events[1]?.messageType).toBe("tool_result");
    expect(tools.messages).toEqual(["final answer"]);
  });

  it("dispatches custom tools before platform tools", async () => {
    const calls: string[] = [];

    const customTool: CustomToolDef = {
      schema: z.object({ city: z.string() }),
      handler: (args) => {
        calls.push(`custom:${(args as { city: string }).city}`);
        return "Sunny, 72F";
      },
      name: "get_weather",
    };

    class CustomToolModel implements ToolCallingModel {
      private turns = 0;
      public async complete(): Promise<{ text?: string; toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }> }> {
        this.turns += 1;
        if (this.turns === 1) {
          return {
            toolCalls: [
              { id: "tc1", name: "get_weather", input: { city: "NYC" } },
            ],
          };
        }
        return { text: "done" };
      }
    }

    const adapter = new OpenAIAdapter({
      model: new CustomToolModel(),
      customTools: [customTool],
    });

    const tools = new FakeTools();
    await adapter.onMessage(fakeMessage, tools, fakeHistory, null, null, {
      isSessionBootstrap: true,
      roomId: "r1",
    });

    expect(calls).toEqual(["custom:NYC"]);
    expect(tools.messages).toEqual(["done"]);
  });

  it("catches custom tool errors and returns error string", async () => {
    const customTool: CustomToolDef = {
      schema: z.object({ query: z.string() }),
      handler: () => { throw new Error("API down"); },
      name: "search",
    };

    class ErrorToolModel implements ToolCallingModel {
      private turns = 0;
      public async complete(req: { toolRounds?: Array<{ toolResults: Array<{ output: unknown }> }>; toolResults?: Array<{ output: unknown }> }): Promise<{ text?: string; toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }> }> {
        this.turns += 1;
        if (this.turns === 1) {
          return {
            toolCalls: [{ id: "tc1", name: "search", input: { query: "test" } }],
          };
        }
        // Verify the error was caught and passed as tool result (check toolRounds first, fall back to deprecated flat field)
        const result = req.toolRounds?.[0]?.toolResults?.[0]?.output ?? req.toolResults?.[0]?.output;
        return { text: typeof result === "string" && result.includes("API down") ? "error_caught" : "no_error" };
      }
    }

    const adapter = new OpenAIAdapter({
      model: new ErrorToolModel(),
      customTools: [customTool],
    });

    const tools = new FakeTools();
    await adapter.onMessage(fakeMessage, tools, fakeHistory, null, null, {
      isSessionBootstrap: true,
      roomId: "r1",
    });

    expect(tools.messages).toEqual(["error_caught"]);
  });
});
