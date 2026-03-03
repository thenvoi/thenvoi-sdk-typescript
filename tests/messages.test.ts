import { describe, expect, it } from "vitest";

import {
  CHAT_EVENT_TYPES,
  CHAT_MESSAGE_TYPES,
  isChatEventType,
  assertChatEventType,
} from "../src/runtime/messages";
import { ValidationError } from "../src/core/errors";

describe("isChatEventType", () => {
  it.each(["tool_call", "tool_result", "thought", "error", "task"] as const)(
    "returns true for valid event type '%s'",
    (type) => {
      expect(isChatEventType(type)).toBe(true);
    },
  );

  it("returns false for 'text'", () => {
    expect(isChatEventType("text")).toBe(false);
  });

  it("returns false for unknown types", () => {
    expect(isChatEventType("unknown")).toBe(false);
    expect(isChatEventType("")).toBe(false);
  });
});

describe("assertChatEventType", () => {
  it("does not throw for valid event types", () => {
    for (const type of CHAT_EVENT_TYPES) {
      expect(() => assertChatEventType(type)).not.toThrow();
    }
  });

  it("throws ValidationError for invalid types", () => {
    expect(() => assertChatEventType("text")).toThrow(ValidationError);
    expect(() => assertChatEventType("invalid")).toThrow(ValidationError);
  });

  it("includes the invalid value and valid options in the error message", () => {
    expect(() => assertChatEventType("bad")).toThrow("Invalid event message_type 'bad'");
    expect(() => assertChatEventType("bad")).toThrow("tool_call");
  });
});

describe("constants", () => {
  it("CHAT_MESSAGE_TYPES includes text and all event types", () => {
    expect(CHAT_MESSAGE_TYPES).toContain("text");
    for (const type of CHAT_EVENT_TYPES) {
      expect(CHAT_MESSAGE_TYPES).toContain(type);
    }
  });

  it("CHAT_EVENT_TYPES does not include text", () => {
    expect(CHAT_EVENT_TYPES).not.toContain("text");
  });
});
