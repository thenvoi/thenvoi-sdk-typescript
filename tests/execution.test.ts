import { describe, expect, it } from "vitest";

import type { PlatformEvent } from "../src/platform/events";
import { Execution } from "../src/runtime/Execution";
import type { ExecutionState } from "../src/runtime/ExecutionContext";

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
      inserted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    raw: {},
  } as unknown as PlatformEvent;
}

function makeContext() {
  const states: ExecutionState[] = [];
  return {
    setState(s: ExecutionState) {
      states.push(s);
    },
    states,
  };
}

describe("Execution", () => {
  it("continues processing later events after a handler failure", async () => {
    const processed: string[] = [];
    let failFirst = true;

    const execution = new Execution({
      context: makeContext() as never,
      onExecute: async (_context, event) => {
        processed.push(event.type);
        if (failFirst) {
          failFirst = false;
          throw new Error("boom");
        }
      },
    });

    await expect(execution.enqueue(makeEvent("m1"))).rejects.toThrow("boom");
    await expect(execution.enqueue(makeEvent("m2"))).resolves.toBeUndefined();
    expect(processed).toEqual(["message_created", "message_created"]);
  });

  it("sets state to processing then idle around execution", async () => {
    const ctx = makeContext();
    const execution = new Execution({
      context: ctx as never,
      onExecute: async () => {},
    });

    await execution.enqueue(makeEvent("m1"));
    expect(ctx.states).toEqual(["processing", "idle"]);
  });

  it("sets state to idle even when handler throws", async () => {
    const ctx = makeContext();
    const execution = new Execution({
      context: ctx as never,
      onExecute: async () => {
        throw new Error("fail");
      },
    });

    await expect(execution.enqueue(makeEvent("m1"))).rejects.toThrow("fail");
    expect(ctx.states).toEqual(["processing", "idle"]);
  });

  it("waitForIdle resolves immediately when no events enqueued", async () => {
    const execution = new Execution({
      context: makeContext() as never,
      onExecute: async () => {},
    });

    expect(execution.isIdle()).toBe(true);
    await expect(execution.waitForIdle()).resolves.toBe(true);
  });

  it("waitForIdle with timeout returns false when processing takes too long", async () => {
    const execution = new Execution({
      context: makeContext() as never,
      onExecute: async () => {
        await new Promise((r) => setTimeout(r, 200));
      },
    });

    const enqueuePromise = execution.enqueue(makeEvent("m1"));
    const result = await execution.waitForIdle(10);
    expect(result).toBe(false);

    // Let it finish
    await enqueuePromise;
  });

  it("processes multiple enqueued events sequentially", async () => {
    const order: string[] = [];
    const execution = new Execution({
      context: makeContext() as never,
      onExecute: async (_context, event) => {
        order.push(event.payload.id);
      },
    });

    const p1 = execution.enqueue(makeEvent("first"));
    const p2 = execution.enqueue(makeEvent("second"));
    const p3 = execution.enqueue(makeEvent("third"));

    await Promise.all([p1, p2, p3]);
    expect(order).toEqual(["first", "second", "third"]);
  });
});
