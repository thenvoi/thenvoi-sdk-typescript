import { describe, expect, it } from "vitest";

import {
  BASE_INSTRUCTIONS,
  CHAT_EVENT_TYPES,
  assertChatEventType,
  isChatEventType,
  MessageRetryTracker,
  ParticipantTracker,
  buildParticipantsMessage,
  formatHistoryForLlm,
  formatMessageForLlm,
  renderSystemPrompt,
  replaceUuidMentions,
} from "../src/index";

describe("runtime utilities", () => {
  it("replaces UUID mentions", () => {
    const replaced = replaceUuidMentions("hello @[[u1]]", [
      { id: "u1", handle: "john" },
    ]);
    expect(replaced).toBe("hello @john");
  });

  it("formats message and history for llm", () => {
    const msg = formatMessageForLlm({
      id: "m1",
      sender_type: "User",
      sender_name: "Jane",
      content: "Hi",
      message_type: "text",
    });
    expect(msg.role).toBe("user");

    const history = formatHistoryForLlm(
      [
        { id: "m1", sender_type: "User", content: "one" },
        { id: "m2", sender_type: "Agent", content: "two" },
      ],
      { excludeId: "m2" },
    );
    expect(history).toHaveLength(1);
  });

  it("builds participant prompt", () => {
    const message = buildParticipantsMessage([{ type: "User", name: "Jane", handle: "jane" }]);
    expect(message).toContain("Current Participants");
    expect(message).toContain("@jane");
  });

  it("renders system prompt", () => {
    const prompt = renderSystemPrompt({
      agentName: "Agent",
      agentDescription: "Helper",
      customSection: "Use concise output.",
    });
    expect(prompt).toContain("Use concise output.");
    expect(prompt).toContain(BASE_INSTRUCTIONS.trim().slice(0, 20));
  });

  it("tracks participants and retries", () => {
    const tracker = new ParticipantTracker();
    expect(tracker.changed()).toBe(true);
    tracker.add({ id: "u1", name: "Jane" });
    expect(tracker.changed()).toBe(true);
    tracker.markSent();
    expect(tracker.changed()).toBe(false);

    const retry = new MessageRetryTracker(1);
    expect(retry.recordAttempt("m1")).toEqual([1, false]);
    expect(retry.recordAttempt("m1")).toEqual([2, true]);
    expect(retry.isPermanentlyFailed("m1")).toBe(true);
  });

  it("provides chat event type guards", () => {
    expect(CHAT_EVENT_TYPES).toContain("tool_call");
    expect(isChatEventType("task")).toBe(true);
    expect(isChatEventType("message_created")).toBe(false);
    expect(() => assertChatEventType("message_created")).toThrow();
  });
});
