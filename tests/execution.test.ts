import { describe, expect, it } from "vitest";

import type { PlatformEvent } from "../src/platform/events";
import { Execution } from "../src/runtime/Execution";

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

describe("Execution queue resilience", () => {
  it("continues processing later events after a handler failure", async () => {
    const processed: string[] = [];
    let failFirst = true;

    const execution = new Execution({
      context: { setState: () => {} } as never,
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
});
