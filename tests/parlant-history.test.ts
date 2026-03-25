import { describe, expect, it } from "vitest";

import { ParlantHistoryConverter } from "../src/adapters/parlant/types";

describe("ParlantHistoryConverter", () => {
  it("converts text history into parlant messages", () => {
    const converter = new ParlantHistoryConverter();

    const result = converter.convert([
      {
        role: "user",
        content: "hello",
        sender_name: "Alice",
        sender_type: "User",
        message_type: "text",
      },
      {
        role: "assistant",
        content: "hi there",
        sender_name: "Gateway",
        sender_type: "Agent",
        message_type: "text",
      },
      {
        role: "assistant",
        content: "tool call",
        sender_name: "Gateway",
        sender_type: "Agent",
        message_type: "tool_call",
      },
    ]);

    expect(result).toEqual([
      {
        role: "user",
        content: "[Alice]: hello",
        sender: "Alice",
        senderType: "User",
      },
      {
        role: "assistant",
        content: "hi there",
        sender: "Gateway",
        senderType: "Agent",
      },
    ]);
  });
});
