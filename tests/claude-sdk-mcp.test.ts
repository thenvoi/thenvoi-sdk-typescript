import { describe, expect, it } from "vitest";

import type { AgentToolsProtocol } from "../src/index";
import { createThenvoiMcpBridge } from "../src/adapters/claude-sdk/mcp";

describe("createThenvoiMcpBridge", () => {
  it("builds thenvoi MCP tools and routes calls to room-scoped tool execution", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

    const roomTools: AgentToolsProtocol = {
      sendMessage: async () => ({ ok: true }),
      sendEvent: async () => ({ ok: true }),
      addParticipant: async () => ({ ok: true }),
      removeParticipant: async () => ({ ok: true }),
      getParticipants: async () => [],
      lookupPeers: async () => ({ data: [] }),
      createChatroom: async () => "room-x",
      getToolSchemas: () => [],
      getAnthropicToolSchemas: () => [],
      getOpenAIToolSchemas: () => [],
      listContacts: async () => ({ data: [] }),
      addContact: async () => ({ ok: true }),
      removeContact: async () => ({ ok: true }),
      listContactRequests: async () => ({ data: [] }),
      respondContactRequest: async () => ({ ok: true }),
      listMemories: async () => ({ data: [] }),
      storeMemory: async () => ({ ok: true }),
      getMemory: async () => ({ ok: true }),
      supersedeMemory: async () => ({ ok: true }),
      archiveMemory: async () => ({ ok: true }),
      executeToolCall: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { ok: true };
      },
    };

    const bridge = createThenvoiMcpBridge({
      enableMemoryTools: false,
      getToolsForRoom: (roomId: string) => (roomId === "room-1" ? roomTools : undefined),
    });

    expect(bridge.allowedTools.some((name) => name === "mcp__thenvoi__thenvoi_send_message")).toBe(true);

    const sendMessageTool = bridge.toolDefinitions.find((entry) => entry.name === "thenvoi_send_message");
    expect(sendMessageTool).toBeDefined();
    if (!sendMessageTool) {
      throw new Error("thenvoi_send_message tool definition missing");
    }

    const result = await sendMessageTool.handler({
      room_id: "room-1",
      content: "hello",
      mentions: ["@a"],
    }, {});

    expect(calls).toEqual([
      {
        name: "thenvoi_send_message",
        args: {
          content: "hello",
          mentions: ["@a"],
        },
      },
    ]);
    expect(result.isError).toBeUndefined();
  });
});
