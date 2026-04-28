import { describe, expect, it } from "vitest";

import { buildConversationPrompt } from "../src/adapters/shared/conversationPrompt";
import { HistoryProvider } from "../src/runtime/types";

describe("buildConversationPrompt", () => {
  it("includes bootstrap history and system updates in stable order", () => {
    const prompt = buildConversationPrompt({
      history: new HistoryProvider([
        { sender_name: "Alice", content: "historic message" },
      ]),
      isSessionBootstrap: true,
      participantsMessage: "Participants changed",
      contactsMessage: "Contacts changed",
      historyHeader: "[History]",
      currentMessage: "Current message",
    });

    expect(prompt).toContain("[History]");
    expect(prompt).toContain("[Alice]: historic message");
    expect(prompt).toContain("[System]: Participants changed");
    expect(prompt).toContain("[System]: Contacts changed");
    expect(prompt.endsWith("Current message")).toBe(true);
  });

  it("omits bootstrap history when session is already warm", () => {
    const prompt = buildConversationPrompt({
      history: new HistoryProvider([
        { sender_name: "Alice", content: "historic message" },
      ]),
      isSessionBootstrap: false,
      participantsMessage: null,
      contactsMessage: null,
      historyHeader: "[History]",
      currentMessage: "Current message",
    });

    expect(prompt).not.toContain("[History]");
    expect(prompt).toBe("Current message");
  });
});
