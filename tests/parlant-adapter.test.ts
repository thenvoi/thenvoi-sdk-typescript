import { describe, expect, it } from "vitest";

import { ParlantAdapter } from "../src/adapters/parlant/ParlantAdapter";
import { FakeTools, makeMessage } from "./testUtils";

class FakeParlantClient {
  public readonly customers = {
    create: async (_params: {
      id?: string;
      name: string;
      metadata?: Record<string, string | undefined>;
    }) => {
      this.customerCreateCount += 1;
      return { id: `customer-${this.customerCreateCount}` };
    },
  };

  public readonly sessions = {
    create: async (_params: {
      agentId: string;
      customerId?: string;
      title?: string;
      metadata?: Record<string, unknown>;
    }) => {
      this.sessionCreateCount += 1;
      return { id: `session-${this.sessionCreateCount}` };
    },
    createEvent: async (
      sessionId: string,
      params: {
        kind: "message" | "status" | "tool" | "custom";
        source:
          | "customer"
          | "customer_ui"
          | "human_agent"
          | "human_agent_on_behalf_of_ai_agent"
          | "ai_agent"
          | "system";
        message?: string;
        data?: unknown;
        moderation?: "auto" | "paranoid" | "none";
        metadata?: Record<string, unknown>;
      },
    ) => {
      this.eventCreateCalls.push({ sessionId, params });
      this.nextOffset += 1;
      return { id: `event-${this.nextOffset}`, offset: this.nextOffset };
    },
    listEvents: async (_sessionId: string) => {
      return this.eventPollBatches.shift() ?? [];
    },
  };

  public customerCreateCount = 0;
  public sessionCreateCount = 0;
  public nextOffset = 0;
  public readonly eventCreateCalls: Array<{
    sessionId: string;
    params: Record<string, unknown>;
  }> = [];
  public eventPollBatches: Array<Array<Record<string, unknown>>> = [];
}

describe("ParlantAdapter", () => {
  it("creates a session and forwards ai-agent response", async () => {
    const client = new FakeParlantClient();
    client.eventPollBatches.push([
      {
        kind: "message",
        offset: 10,
        data: {
          message: "Parlant says hello",
        },
      },
    ]);

    const adapter = new ParlantAdapter({
      environment: "https://parlant.example",
      agentId: "agent-1",
      clientFactory: async () => client,
      responseTimeoutSeconds: 1,
    });

    await adapter.onStarted("Parlant Bridge", "Bridge to parlant");

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("Hi", "room-1"),
      tools,
      [],
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-1" },
    );

    expect(client.customerCreateCount).toBe(1);
    expect(client.sessionCreateCount).toBe(1);
    expect(
      client.eventCreateCalls.some((call) => call.params.source === "customer"),
    ).toBe(true);
    expect(tools.messages).toEqual(["Parlant says hello"]);
  });

  it("injects history once on bootstrap and does not duplicate later", async () => {
    const client = new FakeParlantClient();
    client.eventPollBatches.push([
      {
        kind: "message",
        offset: 20,
        data: { message: "First response" },
      },
    ]);
    client.eventPollBatches.push([
      {
        kind: "message",
        offset: 30,
        data: { message: "Second response" },
      },
    ]);

    const adapter = new ParlantAdapter({
      environment: "https://parlant.example",
      agentId: "agent-1",
      clientFactory: async () => client,
      responseTimeoutSeconds: 1,
    });

    await adapter.onStarted("Parlant Bridge", "Bridge to parlant");

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

    const historicalEventsAfterFirst = client.eventCreateCalls.filter(
      (call) => call.params.metadata && (call.params.metadata as Record<string, unknown>).historical === true,
    ).length;

    await adapter.onMessage(
      makeMessage("Follow up", "room-bootstrap"),
      tools,
      history,
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-bootstrap" },
    );

    const historicalEventsAfterSecond = client.eventCreateCalls.filter(
      (call) => call.params.metadata && (call.params.metadata as Record<string, unknown>).historical === true,
    ).length;

    expect(historicalEventsAfterFirst).toBeGreaterThan(0);
    expect(historicalEventsAfterSecond).toBe(historicalEventsAfterFirst);
  });

  it("emits an error event when no response arrives before timeout", async () => {
    const client = new FakeParlantClient();
    client.eventPollBatches.push([]);
    client.eventPollBatches.push([]);

    const adapter = new ParlantAdapter({
      environment: "https://parlant.example",
      agentId: "agent-1",
      clientFactory: async () => client,
      responseTimeoutSeconds: 1,
    });

    await adapter.onStarted("Parlant Bridge", "Bridge to parlant");

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("Hi", "room-timeout"),
      tools,
      [],
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-timeout" },
    );

    expect(tools.messages).toEqual([]);
    expect(tools.events.some((event) => event.messageType === "error")).toBe(true);
  });
});
