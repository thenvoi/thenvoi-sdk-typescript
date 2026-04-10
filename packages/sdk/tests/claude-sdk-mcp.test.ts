import { describe, expect, it } from "vitest";

import type { AgentToolsProtocol } from "../src/core";
import { createThenvoiSdkMcpServer } from "../src/mcp/sdk";
import { FakeRestApi } from "./testUtils";

describe("createThenvoiSdkMcpServer", () => {
  it("builds thenvoi MCP tools and routes calls to room-scoped tool execution", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

    const roomTools: AgentToolsProtocol = {
      capabilities: { peers: false, contacts: false, memory: false },
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
      listContactRequests: async () => ({ received: [], sent: [] }),
      respondContactRequest: async () => ({ ok: true }),
      listMemories: async () => ({ data: [] }),
      storeMemory: async () => ({ id: "mem-1" }),
      getMemory: async () => ({ id: "mem-1" }),
      supersedeMemory: async () => ({ ok: true }),
      archiveMemory: async () => ({ ok: true }),
      executeToolCall: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { ok: true };
      },
    };

    const bridge = createThenvoiSdkMcpServer({
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

  it("builds room-aware system prompt context and caches it", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let participantCalls = 0;
    const roomTools: AgentToolsProtocol & { rest: FakeRestApi } = {
      ...{
        capabilities: { peers: false, contacts: false, memory: false },
        sendMessage: async () => ({ ok: true }),
        sendEvent: async () => ({ ok: true }),
        addParticipant: async () => ({ ok: true }),
        removeParticipant: async () => ({ ok: true }),
        getParticipants: async () => {
          participantCalls += 1;
          return [
            { id: "user-1", name: "Vlad Luzin", type: "User", handle: "@vlad" },
            { id: "agent-1", name: "Andy", type: "Agent", handle: "@vlad/andy" },
          ];
        },
        lookupPeers: async () => ({ data: [] }),
        createChatroom: async () => "room-x",
        getToolSchemas: () => [],
        getAnthropicToolSchemas: () => [],
        getOpenAIToolSchemas: () => [],
        listContacts: async () => ({ data: [] }),
        addContact: async () => ({ ok: true }),
        removeContact: async () => ({ ok: true }),
        listContactRequests: async () => ({ received: [], sent: [] }),
        respondContactRequest: async () => ({ ok: true }),
        listMemories: async () => ({ data: [] }),
        storeMemory: async () => ({ id: "mem-1" }),
        getMemory: async () => ({ id: "mem-1" }),
        supersedeMemory: async () => ({ ok: true }),
        archiveMemory: async () => ({ ok: true }),
        executeToolCall: async (name: string, args: Record<string, unknown>) => {
          calls.push({ name, args });
          return { ok: true };
        },
      },
      rest: new FakeRestApi({
        listChats: async () => ({ data: [{ id: "room-1", title: "Project Discussion" }] }),
      }, {
        id: "agent-1",
        name: "Andy",
        handle: "@vlad/andy",
        description: "Helper",
      }),
    };

    const bridge = createThenvoiSdkMcpServer({
      enableMemoryTools: false,
      getToolsForRoom: (roomId: string) => (roomId === "room-1" ? roomTools : undefined),
    });

    const first = await bridge.getSystemPromptContext("room-1");
    const second = await bridge.getSystemPromptContext("room-1");

    expect(first).toContain("room-1");
    expect(first).toContain("Project Discussion");
    expect(first).toContain("@vlad/andy");
    expect(first).toContain("@vlad");
    expect(second).toBe(first);
    expect(participantCalls).toBe(1);
  });
});
