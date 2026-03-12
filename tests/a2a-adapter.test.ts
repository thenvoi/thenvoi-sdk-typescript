import { describe, expect, it, vi } from "vitest";

import { A2AAdapter } from "../src/adapters/a2a/A2AAdapter";
import { A2AHistoryConverter } from "../src/adapters/a2a/types";
import { FakeTools, makeMessage } from "./testUtils";

function streamFrom<T>(items: T[]): AsyncGenerator<T, void> {
  return (async function* generator(): AsyncGenerator<T, void> {
    for (const item of items) {
      yield item;
    }
  })();
}

class FakeA2AClient {
  public readonly sendMessageCalls: Array<{ message?: { contextId?: string; taskId?: string } }> = [];
  public readonly resubscribeCalls: Array<{ id?: string }> = [];
  private readonly streamBatches: unknown[][];
  private readonly resubscribeBatches: unknown[][];
  private readonly sendResponses: unknown[];
  private readonly sendErrors: Error[];

  public constructor(options: {
    streamBatches?: unknown[][];
    resubscribeBatches?: unknown[][];
    sendResponses?: unknown[];
    sendErrors?: Error[];
  }) {
    this.streamBatches = [...(options.streamBatches ?? [])];
    this.resubscribeBatches = [...(options.resubscribeBatches ?? [])];
    this.sendResponses = [...(options.sendResponses ?? [])];
    this.sendErrors = [...(options.sendErrors ?? [])];
  }

  public sendMessageStream(
    params: { message?: { contextId?: string; taskId?: string } },
  ): AsyncGenerator<unknown, void> {
    this.sendMessageCalls.push(params);
    return streamFrom(this.streamBatches.shift() ?? []);
  }

  public async sendMessage(
    params: { message?: { contextId?: string; taskId?: string } },
  ): Promise<unknown> {
    this.sendMessageCalls.push(params);
    const error = this.sendErrors.shift();
    if (error) {
      throw error;
    }
    return this.sendResponses.shift() ?? null;
  }

  public resubscribeTask(params: { id?: string }): AsyncGenerator<unknown, void> {
    this.resubscribeCalls.push(params);
    return streamFrom(this.resubscribeBatches.shift() ?? []);
  }
}

describe("A2AHistoryConverter", () => {
  it("extracts most recent A2A session metadata from task history events", () => {
    const converter = new A2AHistoryConverter();
    const state = converter.convert([
      {
        message_type: "task",
        metadata: {
          a2a_context_id: "ctx-1",
          a2a_task_id: "task-1",
          a2a_task_state: "working",
        },
      },
      {
        message_type: "text",
      },
      {
        message_type: "task",
        metadata: {
          a2a_context_id: "ctx-2",
          a2a_task_id: "task-2",
          a2a_task_state: "input-required",
        },
      },
    ]);

    expect(state).toEqual({
      contextId: "ctx-2",
      taskId: "task-2",
      taskState: "input-required",
    });
  });
});

describe("A2AAdapter", () => {
  it("rehydrates context/task state and forwards streamed task updates", async () => {
    const client = new FakeA2AClient({
      resubscribeBatches: [
        [
          {
            kind: "status-update",
            taskId: "task-9",
            contextId: "ctx-9",
            status: { state: "working" },
          },
        ],
      ],
      streamBatches: [
        [
          {
            kind: "status-update",
            taskId: "task-9",
            contextId: "ctx-9",
            status: {
              state: "working",
              message: {
                kind: "message",
                parts: [{ kind: "text", text: "Thinking..." }],
              },
            },
          },
          {
            kind: "status-update",
            taskId: "task-9",
            contextId: "ctx-9",
            status: {
              state: "input-required",
              message: {
                kind: "message",
                parts: [{ kind: "text", text: "Need the currency pair." }],
              },
            },
          },
          {
            kind: "artifact-update",
            taskId: "task-9",
            contextId: "ctx-9",
            artifact: {
              parts: [{ kind: "text", text: "1 USD = 0.92 EUR" }],
            },
          },
          {
            kind: "status-update",
            taskId: "task-9",
            contextId: "ctx-9",
            status: { state: "completed" },
          },
        ],
      ],
    });

    const adapter = new A2AAdapter({
      remoteUrl: "a2a-remote",
      clientFactory: async () => client,
    });
    await adapter.onStarted("A2A Bridge", "Bridge remote A2A agents");

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("Convert 1 USD"),
      tools,
      {
        contextId: "ctx-9",
        taskId: "task-9",
        taskState: "input_required",
      },
      null,
      null,
      { isSessionBootstrap: true, roomId: "room-1" },
    );

    expect(client.resubscribeCalls).toEqual([{ id: "task-9" }]);
    const request = client.sendMessageCalls[0];
    expect(request.message?.contextId).toBe("ctx-9");
    expect(request.message?.taskId).toBe("task-9");

    expect(tools.messages).toContain("Need the currency pair.");
    expect(tools.messages).toContain("1 USD = 0.92 EUR");
    expect(tools.events.some((event) => event.messageType === "thought")).toBe(true);
    expect(tools.events.filter((event) => event.messageType === "task")).toHaveLength(2);
  });

  it("clears terminal task id but preserves context id for the next user turn", async () => {
    const client = new FakeA2AClient({
      streamBatches: [
        [
          {
            kind: "status-update",
            taskId: "task-1",
            contextId: "ctx-1",
            status: {
              state: "completed",
              message: {
                kind: "message",
                parts: [{ kind: "text", text: "Done." }],
              },
            },
          },
        ],
        [],
      ],
    });

    const adapter = new A2AAdapter({
      remoteUrl: "a2a-remote",
      clientFactory: async () => client,
    });

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("First turn", "room-2"),
      tools,
      { contextId: null, taskId: null, taskState: null },
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-2" },
    );
    await adapter.onMessage(
      makeMessage("Second turn", "room-2"),
      tools,
      { contextId: null, taskId: null, taskState: null },
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-2" },
    );

    const first = client.sendMessageCalls[0];
    const second = client.sendMessageCalls[1];

    expect(first.message?.contextId).toBeUndefined();
    expect(second.message?.contextId).toBe("ctx-1");
    expect(second.message?.taskId).toBeUndefined();
  });

  it("reports adapter errors to the room and rethrows", async () => {
    const client = new FakeA2AClient({
      sendErrors: [new Error("upstream failure")],
    });

    const adapter = new A2AAdapter({
      remoteUrl: "a2a-remote",
      streaming: false,
      clientFactory: async () => client,
    });

    const tools = new FakeTools();
    await expect(
      adapter.onMessage(
        makeMessage("hello"),
        tools,
        { contextId: null, taskId: null, taskState: null },
        null,
        null,
        { isSessionBootstrap: false, roomId: "room-3" },
      ),
    ).rejects.toThrow("upstream failure");

    expect(tools.events).toHaveLength(1);
    expect(tools.events[0]?.messageType).toBe("error");
    expect(tools.events[0]?.content).toContain("upstream failure");
    expect(tools.events[0]?.metadata).toMatchObject({ a2a_error: "upstream failure" });
  });

  it("honors a custom maxStreamEvents limit and logs the failure", async () => {
    const client = new FakeA2AClient({
      streamBatches: [
        [
          {
            kind: "message",
            parts: [{ kind: "text", text: "first chunk" }],
          },
          {
            kind: "message",
            parts: [{ kind: "text", text: "second chunk" }],
          },
        ],
      ],
    });
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const adapter = new A2AAdapter({
      remoteUrl: "a2a-remote",
      clientFactory: async () => client,
      maxStreamEvents: 1,
      logger,
    });

    const tools = new FakeTools();
    await expect(
      adapter.onMessage(
        makeMessage("hello", "room-limit"),
        tools,
        { contextId: null, taskId: null, taskState: null },
        null,
        null,
        { isSessionBootstrap: false, roomId: "room-limit" },
      ),
    ).rejects.toThrow("maximum event limit (1)");

    expect(tools.messages).toEqual(["first chunk"]);
    expect(tools.events).toHaveLength(1);
    expect(tools.events[0]?.messageType).toBe("error");
    expect(tools.events[0]?.content).toContain("maximum event limit (1)");
    expect(logger.error).toHaveBeenCalledWith(
      "A2A adapter request failed",
      expect.objectContaining({
        roomId: "room-limit",
        remoteUrl: "a2a-remote",
      }),
    );
  });

  it("rejects invalid maxStreamEvents values", () => {
    expect(
      () =>
        new A2AAdapter({
          remoteUrl: "a2a-remote",
          maxStreamEvents: 0,
        }),
    ).toThrow("positive integer");
  });
});
