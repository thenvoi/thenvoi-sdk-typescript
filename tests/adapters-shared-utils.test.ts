import { describe, expect, it } from "vitest";

import { asNonEmptyString, asRecord } from "../src/adapters/shared/coercion";
import { findLatestTaskMetadata } from "../src/adapters/shared/history";
import { mapConversationMessages } from "../src/adapters/tool-calling/valueUtils";

describe("adapter shared utilities", () => {
  it("normalizes unknown values to a record", () => {
    expect(asRecord(null)).toEqual({});
    expect(asRecord({ ok: true })).toEqual({ ok: true });
  });

  it("extracts non-empty trimmed strings", () => {
    expect(asNonEmptyString("  hello  ")).toBe("hello");
    expect(asNonEmptyString("   ")).toBeNull();
    expect(asNonEmptyString(42)).toBeNull();
  });

  it("finds latest matching task metadata from history", () => {
    const metadata = findLatestTaskMetadata(
      [
        { message_type: "task", metadata: { value: "" } },
        { message_type: "text", metadata: { value: "skip" } },
        { messageType: "task", metadata: { value: "match" } },
      ],
      (entry) => typeof entry.value === "string" && entry.value.length > 0,
    );

    expect(metadata).toEqual({ value: "match" });
  });

  it("maps and filters conversation messages", () => {
    const mapped = mapConversationMessages(
      {
        systemPrompt: "system",
        messages: [
          { role: "user", content: "one" },
          { role: "assistant", content: "two" },
        ],
        tools: [],
      },
      (entry) => (entry.role === "assistant" ? null : entry),
    );

    expect(mapped).toEqual([{ role: "user", content: "one" }]);
  });
});
