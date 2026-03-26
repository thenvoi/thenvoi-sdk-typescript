import { describe, expect, it } from "vitest";

import { buildStatusEvent } from "../src/adapters/a2a-gateway/statusEvent";

describe("a2a-gateway status event helper", () => {
  it("builds a status update envelope with text and metadata", () => {
    const event = buildStatusEvent({
      taskId: "task-1",
      contextId: "ctx-1",
      state: "working",
      final: false,
      text: "processing",
      metadata: { source: "test" },
    });

    expect(event.kind).toBe("status-update");
    expect(event.taskId).toBe("task-1");
    expect(event.contextId).toBe("ctx-1");
    expect(event.final).toBe(false);
    expect(event.status.state).toBe("working");
    expect(event.status.message?.parts).toEqual([{ kind: "text", text: "processing" }]);
    expect(event.metadata).toEqual({ source: "test" });
  });

  it("omits message parts when no text is provided", () => {
    const event = buildStatusEvent({
      taskId: "task-2",
      contextId: "ctx-2",
      state: "completed",
      final: true,
      text: "",
    });

    expect(event.status.message?.parts).toEqual([]);
  });
});
