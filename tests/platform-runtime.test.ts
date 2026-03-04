import { describe, expect, it } from "vitest";

import { GenericAdapter } from "../src/adapters/GenericAdapter";
import { FernRestAdapter, RestFacade } from "../src/client/rest/RestFacade";
import { ValidationError } from "../src/core/errors";
import { PlatformRuntime } from "../src/runtime/PlatformRuntime";
import type { StreamingTransport, TopicHandlers } from "../src/platform/streaming/transport";
import { ThenvoiLink } from "../src/platform/ThenvoiLink";
import { FakeRestApi } from "./testUtils";

class FakeTransport implements StreamingTransport {
  private handlers = new Map<string, TopicHandlers>();
  private connected = false;

  public async connect() {
    this.connected = true;
  }

  public async disconnect() {
    this.connected = false;
  }

  public async join(topic: string, handlers: TopicHandlers) {
    this.handlers.set(topic, handlers);
  }

  public async leave(topic: string) {
    this.handlers.delete(topic);
  }

  public async runForever(signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
  }

  public isConnected() {
    return this.connected;
  }

  public emit(topic: string, event: string, payload: Record<string, unknown>) {
    const topicHandlers = this.handlers.get(topic);
    if (!topicHandlers?.[event]) {
      throw new Error(`No handler for ${topic}/${event}`);
    }

    void topicHandlers[event](payload);
  }

  public hasTopic(topic: string): boolean {
    return this.handlers.has(topic);
  }
}

describe("PlatformRuntime", () => {
  it("initializes and dispatches message to adapter", async () => {
    const transport = new FakeTransport();
    const restApi = new FakeRestApi({}, {
      id: "a1",
      name: "Agent",
      description: "Agent description",
    });

    let seenMessage = "";
    const adapter = new GenericAdapter(async ({ message }) => {
      seenMessage = message.content;
    });

    const runtime = new PlatformRuntime({
      agentId: "a1",
      apiKey: "k",
      link: new ThenvoiLink({
        agentId: "a1",
        apiKey: "k",
        transport,
        restApi,
      }),
    });

    await runtime.start(adapter);

    transport.emit("agent_rooms:a1", "room_added", { id: "room-1", status: "active", type: "direct", title: "Room", removed_at: "" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    transport.emit("chat_room:room-1", "message_created", {
      id: "m1",
      content: "hello runtime",
      message_type: "text",
      sender_id: "u1",
      sender_type: "User",
      sender_name: "Jane",
      inserted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtime.name).toBe("Agent");
    expect(seenMessage).toBe("hello runtime");

    await runtime.stop();
  });

  it("exposes fern adapter for duck-typed client", async () => {
    const adapter = new FernRestAdapter({
      myProfile: {
        getMyProfile: async () => ({ id: "a1", name: "Agent" }),
      },
      chatMessages: {
        createChatMessage: async () => ({ ok: true }),
        markMessageProcessing: async () => ({ ok: true }),
        markMessageProcessed: async () => ({ ok: true }),
        markMessageFailed: async () => ({ ok: true }),
      },
      chatRooms: {
        createChat: async () => ({ id: "room-1" }),
      },
      chatParticipants: {
        listChatParticipants: async () => ({ data: [] }),
        addChatParticipant: async () => ({ ok: true }),
        removeChatParticipant: async () => ({ ok: true }),
      },
    });

    const rest = new RestFacade({ api: adapter });
    await expect(rest.getAgentMe()).resolves.toEqual({ id: "a1", name: "Agent", description: null });
  });

  it("auto-subscribes existing rooms and unsubscribes on room_deleted", async () => {
    const transport = new FakeTransport();
    const restApi = new FakeRestApi({
      listChats: async () => ({
        data: [{ id: "room-existing", title: "Existing Room" }],
        metadata: { page: 1, pageSize: 100, totalPages: 1, totalCount: 1 },
      }),
    });
    const seenMessages: string[] = [];

    const adapter = new GenericAdapter(async ({ message }) => {
      seenMessages.push(message.content);
    });

    const runtime = new PlatformRuntime({
      agentId: "a1",
      apiKey: "k",
      link: new ThenvoiLink({
        agentId: "a1",
        apiKey: "k",
        transport,
        restApi,
      }),
      agentConfig: {
        autoSubscribeExistingRooms: true,
      },
    });

    await runtime.start(adapter);

    expect(transport.hasTopic("chat_room:room-existing")).toBe(true);
    expect(transport.hasTopic("room_participants:room-existing")).toBe(true);

    transport.emit("chat_room:room-existing", "message_created", {
      id: "m1",
      content: "hello existing",
      message_type: "text",
      sender_id: "u1",
      sender_type: "User",
      sender_name: "Jane",
      inserted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seenMessages).toEqual(["hello existing"]);

    transport.emit("room_participants:room-existing", "room_deleted", {
      id: "room-existing",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transport.hasTopic("chat_room:room-existing")).toBe(false);
    expect(transport.hasTopic("room_participants:room-existing")).toBe(false);

    await runtime.stop();
  });

  it("throws ValidationError when agentId is empty", () => {
    expect(
      () => new PlatformRuntime({ agentId: "", apiKey: "valid-key" }),
    ).toThrow(ValidationError);
    expect(
      () => new PlatformRuntime({ agentId: "", apiKey: "valid-key" }),
    ).toThrow("agentId is required");
  });

  it("throws ValidationError when agentId is whitespace-only", () => {
    expect(
      () => new PlatformRuntime({ agentId: "  ", apiKey: "valid-key" }),
    ).toThrow(ValidationError);
  });

  it("throws ValidationError when apiKey is empty", () => {
    expect(
      () => new PlatformRuntime({ agentId: "valid-id", apiKey: "" }),
    ).toThrow(ValidationError);
    expect(
      () => new PlatformRuntime({ agentId: "valid-id", apiKey: "" }),
    ).toThrow("apiKey is required");
  });

  it("throws ValidationError when apiKey is whitespace-only", () => {
    expect(
      () => new PlatformRuntime({ agentId: "valid-id", apiKey: "   " }),
    ).toThrow(ValidationError);
  });

  it("validation error message mentions loadAgentConfig", () => {
    expect(
      () => new PlatformRuntime({ agentId: "", apiKey: "valid-key" }),
    ).toThrow("loadAgentConfig()");
  });
});
