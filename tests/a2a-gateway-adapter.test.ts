import { describe, expect, it } from "vitest";

import { A2AGatewayAdapter } from "../src/adapters/a2a-gateway/A2AGatewayAdapter";
import type {
  GatewayRequest,
  GatewayServerFactory,
  GatewayServerLike,
} from "../src/adapters/a2a-gateway/types";
import type {
  ChatMessageMention,
  ChatParticipant,
  RestApi,
} from "../src/client/rest/types";
import { FakeTools, makeMessage } from "./testUtils";

class FakeRestApi implements RestApi {
  public readonly createChatCalls: string[] = [];
  public readonly addParticipantCalls: Array<{
    chatId: string;
    participantId: string;
  }> = [];
  public readonly createMessageCalls: Array<{
    chatId: string;
    content: string;
    mentions?: ChatMessageMention[];
  }> = [];
  public readonly createEventCalls: Array<{
    chatId: string;
    metadata?: Record<string, unknown>;
  }> = [];

  public async getAgentMe() {
    return {
      id: "gateway-agent",
      name: "Gateway Agent",
      description: "A2A gateway",
    };
  }

  public async createChatMessage(
    chatId: string,
    message: {
      content: string;
      messageType?: string;
      metadata?: Record<string, unknown>;
      mentions?: ChatMessageMention[];
    },
  ): Promise<Record<string, unknown>> {
    this.createMessageCalls.push({
      chatId,
      content: message.content,
      mentions: message.mentions,
    });
    return { id: `msg-${this.createMessageCalls.length}` };
  }

  public async createChatEvent(
    chatId: string,
    event: {
      content: string;
      messageType: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>> {
    this.createEventCalls.push({ chatId, metadata: event.metadata });
    return { ok: true };
  }

  public async createChat(taskId?: string): Promise<{ id: string }> {
    this.createChatCalls.push(taskId ?? "");
    return { id: `room-${this.createChatCalls.length}` };
  }

  public async listChatParticipants(): Promise<ChatParticipant[]> {
    return [];
  }

  public async addChatParticipant(
    chatId: string,
    participant: { participantId: string; role: string },
  ): Promise<Record<string, unknown>> {
    this.addParticipantCalls.push({
      chatId,
      participantId: participant.participantId,
    });
    return { ok: true };
  }

  public async removeChatParticipant(): Promise<Record<string, unknown>> {
    return { ok: true };
  }

  public async markMessageProcessing(): Promise<Record<string, unknown>> {
    return { ok: true };
  }

  public async markMessageProcessed(): Promise<Record<string, unknown>> {
    return { ok: true };
  }

  public async markMessageFailed(): Promise<Record<string, unknown>> {
    return { ok: true };
  }

  public async listPeers(
    request: { page: number; pageSize: number; notInChat: string },
  ): Promise<{ data: Array<Record<string, unknown>> }> {
    if (request.page > 1) {
      return { data: [] };
    }

    return {
      data: [
        {
          id: "peer-weather",
          name: "Weather Agent",
          handle: "weather-agent",
          description: "Weather specialist",
        },
        {
          id: "peer-data",
          name: "Data Agent",
          handle: "data-agent",
          description: "Data specialist",
        },
      ],
    };
  }
}

describe("A2AGatewayAdapter", () => {
  it("routes A2A requests into Thenvoi rooms and streams completion", async () => {
    const rest = new FakeRestApi();

    let onRequest: ((request: GatewayRequest) => AsyncIterable<unknown>) | null = null;
    let serverStarted = false;
    const serverFactory: GatewayServerFactory = (options) => {
      onRequest = options.onRequest;
      return {
        start: async () => {
          serverStarted = true;
        },
        stop: async () => {
          serverStarted = false;
        },
      } satisfies GatewayServerLike;
    };

    const adapter = new A2AGatewayAdapter({
      thenvoiRest: rest,
      serverFactory,
      responseTimeoutMs: 2_000,
    });

    await adapter.onStarted("Gateway", "A2A gateway");
    expect(serverStarted).toBe(true);
    expect(onRequest).not.toBeNull();

    const stream = onRequest!({
      peerId: "weather-agent",
      taskId: "task-1",
      contextId: "ctx-1",
      message: {
        kind: "message",
        messageId: "user-msg-1",
        role: "user",
        parts: [{ kind: "text", text: "What is the weather in NYC?" }],
      },
    });

    const iterator = stream[Symbol.asyncIterator]();
    const firstEvent = await iterator.next();
    expect(firstEvent.value).toMatchObject({
      kind: "status-update",
      final: false,
      status: { state: "working" },
    });

    await adapter.onMessage(
      makeMessage("Sunny and 72F", "room-1"),
      new FakeTools(),
      {
        contextToRoom: {},
        roomParticipants: {},
      },
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-1" },
    );

    const finalEvent = await iterator.next();
    expect(finalEvent.value).toMatchObject({
      kind: "status-update",
      final: true,
      status: { state: "completed" },
    });

    expect(rest.createChatCalls).toEqual(["a2a:gateway:ctx-1"]);
    expect(rest.addParticipantCalls).toEqual([
      { chatId: "room-1", participantId: "peer-weather" },
    ]);
    expect(rest.createEventCalls[0]?.metadata).toMatchObject({
      gateway_context_id: "ctx-1",
      gateway_room_id: "room-1",
    });
    expect(rest.createMessageCalls[0]).toMatchObject({
      chatId: "room-1",
      content: "@Weather Agent What is the weather in NYC?",
      mentions: [{ id: "peer-weather", handle: "weather-agent" }],
    });
  });

  it("reuses a room for the same context and peer", async () => {
    const rest = new FakeRestApi();

    let onRequest: ((request: GatewayRequest) => AsyncIterable<unknown>) | null = null;
    const adapter = new A2AGatewayAdapter({
      thenvoiRest: rest,
      serverFactory: (options) => {
        onRequest = options.onRequest;
        return {
          start: async () => undefined,
          stop: async () => undefined,
        };
      },
      responseTimeoutMs: 2_000,
    });

    await adapter.onStarted("Gateway", "A2A gateway");

    const stream1 = onRequest!({
      peerId: "weather-agent",
      taskId: "task-1",
      contextId: "ctx-sticky",
      message: {
        kind: "message",
        messageId: "m-1",
        role: "user",
        parts: [{ kind: "text", text: "First" }],
      },
    });
    const iterator1 = stream1[Symbol.asyncIterator]();
    await iterator1.next();
    await adapter.onMessage(
      makeMessage("done", "room-1"),
      new FakeTools(),
      { contextToRoom: {}, roomParticipants: {} },
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-1" },
    );
    await iterator1.next();

    const stream2 = onRequest!({
      peerId: "weather-agent",
      taskId: "task-2",
      contextId: "ctx-sticky",
      message: {
        kind: "message",
        messageId: "m-2",
        role: "user",
        parts: [{ kind: "text", text: "Second" }],
      },
    });
    const iterator2 = stream2[Symbol.asyncIterator]();
    await iterator2.next();
    await adapter.onMessage(
      makeMessage("done again", "room-1"),
      new FakeTools(),
      { contextToRoom: {}, roomParticipants: {} },
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-1" },
    );
    await iterator2.next();

    expect(rest.createChatCalls).toHaveLength(1);
    expect(rest.addParticipantCalls).toHaveLength(1);
  });

  it("returns a failed terminal event when peer does not exist", async () => {
    const rest = new FakeRestApi();

    let onRequest: ((request: GatewayRequest) => AsyncIterable<unknown>) | null = null;
    const adapter = new A2AGatewayAdapter({
      thenvoiRest: rest,
      serverFactory: (options) => {
        onRequest = options.onRequest;
        return {
          start: async () => undefined,
          stop: async () => undefined,
        };
      },
    });

    await adapter.onStarted("Gateway", "A2A gateway");

    const stream = onRequest!({
      peerId: "missing-peer",
      taskId: "task-missing",
      contextId: "ctx-missing",
      message: {
        kind: "message",
        messageId: "m-missing",
        role: "user",
        parts: [{ kind: "text", text: "Hello" }],
      },
    });

    const result = await stream[Symbol.asyncIterator]().next();
    expect(result.value).toMatchObject({
      kind: "status-update",
      final: true,
      status: { state: "failed" },
    });
    expect(rest.createMessageCalls).toHaveLength(0);
  });
});
