import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlatformEvent } from "../src/platform/events";
import { Execution } from "../src/runtime/Execution";
import type { ExecutionState } from "../src/runtime/ExecutionContext";

interface BacklogMessage {
  id: string;
  roomId: string;
  content: string;
  senderId: string;
  senderType: string;
  senderName: string | null;
  messageType: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

function makeEvent(id: string): PlatformEvent {
  return {
    type: "message_created",
    roomId: "room-1",
    payload: {
      id,
      content: "hello",
      message_type: "text",
      sender_id: "user-1",
      sender_type: "User",
      sender_name: "User One",
      metadata: {},
      inserted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

function makeContext() {
  const states: ExecutionState[] = [];
  return {
    setState(state: ExecutionState) {
      states.push(state);
    },
    states,
  };
}

function createExecution(options?: {
  onExecute?: (event: PlatformEvent) => Promise<void>;
  getNextMessage?: () => Promise<BacklogMessage | null>;
}) {
  const context = makeContext();
  const processed: string[] = [];
  const execution = new Execution({
    roomId: "room-1",
    link: {
      getNextMessage: options?.getNextMessage ?? (async () => null),
    } as never,
    context: context as never,
    onExecute: async (_context, event) => {
      if (event.type === "message_created") {
        processed.push(event.payload.id);
      }
      await options?.onExecute?.(event);
    },
  });

  return {
    context,
    processed,
    execution,
  };
}

describe("Execution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("continues processing later events after a handler failure", async () => {
    let failFirst = true;
    const { execution, processed } = createExecution({
      onExecute: async () => {
        if (failFirst) {
          failFirst = false;
          throw new Error("boom");
        }
      },
    });

    await execution.enqueue(makeEvent("m1"));
    await execution.enqueue(makeEvent("m2"));
    await expect(execution.waitForIdle()).resolves.toBe(true);
    expect(processed).toEqual(["m1", "m2"]);
    await execution.stop();
  });

  it("sets state to processing then idle around execution", async () => {
    const { execution, context } = createExecution();

    await execution.enqueue(makeEvent("m1"));
    await execution.waitForIdle();
    expect(context.states).toEqual(["processing", "idle"]);
    await execution.stop();
  });

  it("waitForIdle resolves immediately when there is no backlog or queued work", async () => {
    const { execution } = createExecution();

    await expect(execution.waitForIdle()).resolves.toBe(true);
    await execution.stop();
  });

  it("waitForIdle with timeout returns false when processing takes too long", async () => {
    const { execution } = createExecution({
      onExecute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      },
    });

    await execution.enqueue(makeEvent("m1"));
    await expect(execution.waitForIdle(10)).resolves.toBe(false);
    await execution.stop();
  });

  it("synchronizes backlog via /messages/next before live websocket events", async () => {
    let releaseSync!: () => void;
    const syncGate = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    const getNextMessage = vi.fn<() => Promise<BacklogMessage | null>>();
    const backlogMessages: BacklogMessage[] = [
      {
        id: "m-backlog",
        roomId: "room-1",
        content: "backlog",
        senderId: "user-1",
        senderType: "User",
        senderName: "User One",
        messageType: "text",
        metadata: {},
        createdAt: new Date("2026-03-05T00:00:00.000Z"),
      },
      {
        id: "m-sync",
        roomId: "room-1",
        content: "sync",
        senderId: "user-1",
        senderType: "User",
        senderName: "User One",
        messageType: "text",
        metadata: {},
        createdAt: new Date("2026-03-05T00:00:01.000Z"),
      },
    ];
    getNextMessage.mockImplementation(async () => {
      await syncGate;
      return backlogMessages.shift() ?? null;
    });

    const { execution, processed } = createExecution({ getNextMessage });

    await execution.enqueue(makeEvent("m-sync"));
    await execution.enqueue(makeEvent("m-live"));
    releaseSync();

    await execution.waitForIdle();
    expect(processed).toEqual(["m-backlog", "m-sync", "m-live"]);
    await execution.stop();
  });
});
