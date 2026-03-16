import { describe, expect, it, vi } from "vitest";

import { LettaAdapter } from "../src/adapters/letta/LettaAdapter";
import type {
  LettaClientLike,
  LettaResponse,
  LettaMessageCreateParams,
} from "../src/adapters/letta/LettaAdapter";
import { FakeTools, makeMessage } from "./testUtils";

// ---------------------------------------------------------------------------
// Fake Letta client
// ---------------------------------------------------------------------------

class FakeLettaClient implements LettaClientLike {
  public agentCreateCount = 0;
  public agentDeleteCount = 0;
  public readonly messageCreateCalls: Array<{
    agentId: string;
    params: LettaMessageCreateParams;
  }> = [];
  public responseBatches: LettaResponse[] = [];

  public readonly agents = {
    create: async (_params: Record<string, unknown>) => {
      this.agentCreateCount += 1;
      return { id: `letta-agent-${this.agentCreateCount}` };
    },
    delete: async (_agentId: string) => {
      this.agentDeleteCount += 1;
    },
    messages: {
      create: async (
        agentId: string,
        params: LettaMessageCreateParams,
      ): Promise<LettaResponse> => {
        this.messageCreateCalls.push({ agentId, params });
        const next = this.responseBatches.shift();
        if (!next) {
          return {
            messages: [],
            stop_reason: { stop_reason: "end_turn" },
          };
        }
        return next;
      },
    },
  };
}

function assistantResponse(content: string): LettaResponse {
  return {
    messages: [
      {
        id: "msg-1",
        message_type: "assistant_message",
        content,
      },
    ],
    stop_reason: { stop_reason: "end_turn" },
  };
}

function approvalResponse(
  toolName: string,
  args: Record<string, unknown>,
  toolCallId = "tc-1",
): LettaResponse {
  return {
    messages: [
      {
        id: "msg-1",
        message_type: "approval_request_message",
        tool_call: {
          name: toolName,
          arguments: JSON.stringify(args),
          tool_call_id: toolCallId,
        },
      },
    ],
    stop_reason: { stop_reason: "requires_approval" },
  };
}

function reasoningResponse(reasoning: string, content: string): LettaResponse {
  return {
    messages: [
      {
        id: "msg-1",
        message_type: "reasoning_message",
        reasoning,
      },
      {
        id: "msg-2",
        message_type: "assistant_message",
        content,
      },
    ],
    stop_reason: { stop_reason: "end_turn" },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LettaAdapter", () => {
  it("creates a per-room agent and forwards the assistant response", async () => {
    const client = new FakeLettaClient();
    client.responseBatches.push(assistantResponse("Hello from Letta!"));

    const adapter = new LettaAdapter({
      model: "openai/gpt-4o",
      clientFactory: async () => client,
    });

    await adapter.onStarted("Letta Bridge", "Bridge to Letta");

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("Hi", "room-1"),
      tools,
      [],
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-1" },
    );

    expect(client.agentCreateCount).toBe(1);
    expect(client.messageCreateCalls).toHaveLength(1);
    expect(client.messageCreateCalls[0].agentId).toBe("letta-agent-1");
    expect(tools.messages).toEqual(["Hello from Letta!"]);
  });

  it("reuses the same agent for the same room", async () => {
    const client = new FakeLettaClient();
    client.responseBatches.push(
      assistantResponse("First"),
      assistantResponse("Second"),
    );

    const adapter = new LettaAdapter({
      clientFactory: async () => client,
    });

    await adapter.onStarted("Agent", "An agent");

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("A", "room-1"),
      tools,
      [],
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-1" },
    );
    await adapter.onMessage(
      makeMessage("B", "room-1"),
      tools,
      [],
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-1" },
    );

    expect(client.agentCreateCount).toBe(1);
    expect(tools.messages).toEqual(["First", "Second"]);
  });

  it("creates separate agents for different rooms", async () => {
    const client = new FakeLettaClient();
    client.responseBatches.push(
      assistantResponse("Room A"),
      assistantResponse("Room B"),
    );

    const adapter = new LettaAdapter({
      clientFactory: async () => client,
    });

    await adapter.onStarted("Agent", "An agent");

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("Hi", "room-a"),
      tools,
      [],
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-a" },
    );
    await adapter.onMessage(
      makeMessage("Hi", "room-b"),
      tools,
      [],
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-b" },
    );

    expect(client.agentCreateCount).toBe(2);
    expect(tools.messages).toEqual(["Room A", "Room B"]);
  });

  it("uses shared lettaAgentId when provided", async () => {
    const client = new FakeLettaClient();
    client.responseBatches.push(assistantResponse("Shared agent response"));

    const adapter = new LettaAdapter({
      lettaAgentId: "pre-existing-agent",
      clientFactory: async () => client,
    });

    await adapter.onStarted("Agent", "An agent");

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("Hi", "room-1"),
      tools,
      [],
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-1" },
    );

    expect(client.agentCreateCount).toBe(0);
    expect(client.messageCreateCalls[0].agentId).toBe("pre-existing-agent");
    expect(tools.messages).toEqual(["Shared agent response"]);
  });

  it("handles client-side tool execution loop", async () => {
    const client = new FakeLettaClient();
    client.responseBatches.push(
      approvalResponse("thenvoi_send_event", {
        content: "Thinking...",
        message_type: "thought",
      }),
      assistantResponse("Done!"),
    );

    const adapter = new LettaAdapter({
      clientFactory: async () => client,
    });

    await adapter.onStarted("Agent", "An agent");

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("Do something", "room-tools"),
      tools,
      [],
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-tools" },
    );

    // 1: initial user message, 2: tool result sent back
    expect(client.messageCreateCalls).toHaveLength(2);

    const toolResultCall = client.messageCreateCalls[1];
    expect(toolResultCall.params.messages?.[0]?.role).toBe("tool");
    expect(toolResultCall.params.messages?.[0]?.tool_call_id).toBe("tc-1");

    expect(tools.messages).toEqual(["Done!"]);
  });

  it("respects maxToolRounds limit", async () => {
    const client = new FakeLettaClient();
    for (let i = 0; i < 20; i++) {
      client.responseBatches.push(
        approvalResponse("some_tool", { arg: i }, `tc-${i}`),
      );
    }
    client.responseBatches.push(assistantResponse("Final"));

    const adapter = new LettaAdapter({
      clientFactory: async () => client,
      maxToolRounds: 3,
    });

    await adapter.onStarted("Agent", "An agent");

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("Loop", "room-limit"),
      tools,
      [],
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-limit" },
    );

    const toolCalls = client.messageCreateCalls.filter((c) =>
      c.params.messages?.some((m) => m.role === "tool"),
    );
    expect(toolCalls).toHaveLength(3);
  });

  it("emits reasoning messages as thought events", async () => {
    const client = new FakeLettaClient();
    client.responseBatches.push(
      reasoningResponse("Let me think about this...", "Here's my answer"),
    );

    const adapter = new LettaAdapter({
      clientFactory: async () => client,
      emitReasoningEvents: true,
    });

    await adapter.onStarted("Agent", "An agent");

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("Question", "room-reason"),
      tools,
      [],
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-reason" },
    );

    expect(tools.messages).toEqual(["Here's my answer"]);
    expect(tools.events.some((e) => e.messageType === "thought")).toBe(true);
    expect(
      tools.events.find((e) => e.messageType === "thought")?.content,
    ).toBe("Let me think about this...");
  });

  it("does not emit reasoning events when disabled", async () => {
    const client = new FakeLettaClient();
    client.responseBatches.push(
      reasoningResponse("Secret thoughts", "Public answer"),
    );

    const adapter = new LettaAdapter({
      clientFactory: async () => client,
      emitReasoningEvents: false,
    });

    await adapter.onStarted("Agent", "An agent");

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("Question", "room-no-reason"),
      tools,
      [],
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-no-reason" },
    );

    expect(tools.messages).toEqual(["Public answer"]);
    expect(tools.events.filter((e) => e.messageType === "thought")).toHaveLength(0);
  });

  it("injects history on bootstrap", async () => {
    const client = new FakeLettaClient();
    // First call: history injection, second call: actual message
    client.responseBatches.push(
      assistantResponse("Acknowledged history"),
      assistantResponse("Current response"),
    );

    const adapter = new LettaAdapter({
      clientFactory: async () => client,
    });

    await adapter.onStarted("Agent", "An agent");

    const history = [
      {
        role: "user" as const,
        content: "[User]: Earlier question",
        sender: "User",
        senderType: "User",
      },
      {
        role: "assistant" as const,
        content: "Earlier answer",
        sender: "Assistant",
        senderType: "Agent",
      },
    ];

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("Current question", "room-bootstrap"),
      tools,
      history,
      null,
      null,
      { isSessionBootstrap: true, roomId: "room-bootstrap" },
    );

    // History injection + actual message = 2 API calls (plus agent.create)
    expect(client.messageCreateCalls).toHaveLength(2);
    const historyCall = client.messageCreateCalls[0];
    expect(historyCall.params.messages?.[0]?.content).toContain(
      "conversation history",
    );
    expect(tools.messages).toEqual(["Current response"]);
  });

  it("does not duplicate history injection on subsequent messages", async () => {
    const client = new FakeLettaClient();
    client.responseBatches.push(
      assistantResponse("History ack"),
      assistantResponse("First"),
      assistantResponse("Second"),
    );

    const adapter = new LettaAdapter({
      clientFactory: async () => client,
    });

    await adapter.onStarted("Agent", "An agent");

    const history = [
      {
        role: "user" as const,
        content: "Past",
        sender: "User",
        senderType: "User",
      },
      {
        role: "assistant" as const,
        content: "Past reply",
        sender: "Assistant",
        senderType: "Agent",
      },
    ];

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("A", "room-once"),
      tools,
      history,
      null,
      null,
      { isSessionBootstrap: true, roomId: "room-once" },
    );
    await adapter.onMessage(
      makeMessage("B", "room-once"),
      tools,
      history,
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-once" },
    );

    // History injection once + 2 actual messages = 3 API calls
    expect(client.messageCreateCalls).toHaveLength(3);
  });

  it("emits error event when Letta returns no assistant message", async () => {
    const client = new FakeLettaClient();
    client.responseBatches.push({
      messages: [],
      stop_reason: { stop_reason: "end_turn" },
    });

    const adapter = new LettaAdapter({
      clientFactory: async () => client,
    });

    await adapter.onStarted("Agent", "An agent");

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("Hi", "room-empty"),
      tools,
      [],
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-empty" },
    );

    expect(tools.messages).toEqual([]);
    expect(tools.events.some((e) => e.messageType === "error")).toBe(true);
  });

  it("logs and re-throws on client error", async () => {
    const client = new FakeLettaClient();
    client.agents.messages.create = async () => {
      throw new Error("Letta API error");
    };

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const adapter = new LettaAdapter({
      clientFactory: async () => client,
      logger,
    });

    await adapter.onStarted("Agent", "An agent");

    const tools = new FakeTools();
    await expect(
      adapter.onMessage(
        makeMessage("Hi", "room-err"),
        tools,
        [],
        null,
        null,
        { isSessionBootstrap: false, roomId: "room-err" },
      ),
    ).rejects.toThrow("Letta API error");

    expect(tools.events.some((e) => e.messageType === "error")).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      "Letta adapter request failed",
      expect.objectContaining({ roomId: "room-err" }),
    );
  });

  it("logs client initialization failures", async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const adapter = new LettaAdapter({
      clientFactory: async () => {
        throw new Error("init failed");
      },
      logger,
    });

    await adapter.onStarted("Agent", "An agent");

    const tools = new FakeTools();
    await expect(
      adapter.onMessage(
        makeMessage("Hi", "room-init"),
        tools,
        [],
        null,
        null,
        { isSessionBootstrap: false, roomId: "room-init" },
      ),
    ).rejects.toThrow("init failed");

    expect(logger.error).toHaveBeenCalledWith(
      "Letta client initialization failed",
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it("cleans up room state and deletes the Letta agent on onCleanup", async () => {
    const client = new FakeLettaClient();
    client.responseBatches.push(
      assistantResponse("Hello"),
      assistantResponse("After cleanup"),
    );

    const adapter = new LettaAdapter({
      clientFactory: async () => client,
    });

    await adapter.onStarted("Agent", "An agent");

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("Hi", "room-clean"),
      tools,
      [],
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-clean" },
    );

    expect(client.agentCreateCount).toBe(1);
    expect(client.agentDeleteCount).toBe(0);

    await adapter.onCleanup("room-clean");

    expect(client.agentDeleteCount).toBe(1);

    await adapter.onMessage(
      makeMessage("Hi again", "room-clean"),
      tools,
      [],
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-clean" },
    );

    // After cleanup, a new agent should be created for the room
    expect(client.agentCreateCount).toBe(2);
  });

  it("does not delete shared agent on cleanup", async () => {
    const client = new FakeLettaClient();
    client.responseBatches.push(assistantResponse("Hello"));

    const adapter = new LettaAdapter({
      lettaAgentId: "shared-agent",
      clientFactory: async () => client,
    });

    await adapter.onStarted("Agent", "An agent");

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("Hi", "room-shared"),
      tools,
      [],
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-shared" },
    );

    await adapter.onCleanup("room-shared");

    expect(client.agentDeleteCount).toBe(0);
  });

  it("serializes concurrent agent creation for the same room", async () => {
    const client = new FakeLettaClient();
    client.responseBatches.push(
      assistantResponse("First"),
      assistantResponse("Second"),
    );

    const adapter = new LettaAdapter({
      clientFactory: async () => client,
    });

    await adapter.onStarted("Agent", "An agent");

    const tools = new FakeTools();
    await Promise.all([
      adapter.onMessage(
        makeMessage("A", "room-race"),
        tools,
        [],
        null,
        null,
        { isSessionBootstrap: false, roomId: "room-race" },
      ),
      adapter.onMessage(
        makeMessage("B", "room-race"),
        tools,
        [],
        null,
        null,
        { isSessionBootstrap: false, roomId: "room-race" },
      ),
    ]);

    expect(client.agentCreateCount).toBe(1);
    expect(tools.messages).toHaveLength(2);
  });

  it("includes participants and contacts in user message", async () => {
    const client = new FakeLettaClient();
    client.responseBatches.push(assistantResponse("Got it"));

    const adapter = new LettaAdapter({
      clientFactory: async () => client,
    });

    await adapter.onStarted("Agent", "An agent");

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("Hello", "room-ctx"),
      tools,
      [],
      "Alice joined the room",
      "Bob is online",
      { isSessionBootstrap: false, roomId: "room-ctx" },
    );

    const sentContent = client.messageCreateCalls[0].params.messages?.[0]?.content ?? "";
    expect(sentContent).toContain("Alice joined the room");
    expect(sentContent).toContain("Bob is online");
    expect(sentContent).toContain("Hello");
  });

  it("returns a structured error for malformed tool arguments JSON", async () => {
    const client = new FakeLettaClient();
    client.responseBatches.push(
      {
        messages: [
          {
            id: "msg-1",
            message_type: "approval_request_message",
            tool_call: {
              name: "some_tool",
              arguments: "not valid json{{{",
              tool_call_id: "tc-bad",
            },
          },
        ],
        stop_reason: { stop_reason: "requires_approval" },
      },
      assistantResponse("Recovered"),
    );

    const adapter = new LettaAdapter({
      clientFactory: async () => client,
    });

    await adapter.onStarted("Agent", "An agent");

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("Do it", "room-bad-json"),
      tools,
      [],
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-bad-json" },
    );

    const toolResult = client.messageCreateCalls[1]?.params.messages?.[0];
    expect(toolResult?.role).toBe("tool");
    expect(toolResult?.content).toContain("not valid JSON");
    expect(tools.messages).toEqual(["Recovered"]);
  });

  it("logs and continues when history injection fails", async () => {
    const client = new FakeLettaClient();
    const originalCreate = client.agents.messages.create;
    let firstCall = true;
    client.agents.messages.create = async (agentId, params) => {
      if (firstCall && params.max_steps === 1) {
        firstCall = false;
        throw new Error("injection failed");
      }
      return originalCreate.call(client.agents.messages, agentId, params);
    };
    client.responseBatches.push(assistantResponse("Response after failed injection"));

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const adapter = new LettaAdapter({
      clientFactory: async () => client,
      logger,
    });

    await adapter.onStarted("Agent", "An agent");

    const history = [
      {
        role: "user" as const,
        content: "Past question",
        sender: "User",
        senderType: "User",
      },
      {
        role: "assistant" as const,
        content: "Past answer",
        sender: "Bot",
        senderType: "Agent",
      },
    ];

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("Current", "room-inject-fail"),
      tools,
      history,
      null,
      null,
      { isSessionBootstrap: true, roomId: "room-inject-fail" },
    );

    expect(logger.warn).toHaveBeenCalledWith(
      "Letta history injection failed",
      expect.objectContaining({ agentId: "letta-agent-1" }),
    );
    expect(tools.messages).toEqual(["Response after failed injection"]);
  });

  it("passes max_steps: 1 for history injection", async () => {
    const client = new FakeLettaClient();
    client.responseBatches.push(
      assistantResponse("History ack"),
      assistantResponse("Actual response"),
    );

    const adapter = new LettaAdapter({
      clientFactory: async () => client,
    });

    await adapter.onStarted("Agent", "An agent");

    const history = [
      {
        role: "user" as const,
        content: "Past",
        sender: "User",
        senderType: "User",
      },
      {
        role: "assistant" as const,
        content: "Past reply",
        sender: "Bot",
        senderType: "Agent",
      },
    ];

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("Now", "room-max-steps"),
      tools,
      history,
      null,
      null,
      { isSessionBootstrap: true, roomId: "room-max-steps" },
    );

    const historyCall = client.messageCreateCalls[0];
    expect(historyCall.params.max_steps).toBe(1);
  });
});
