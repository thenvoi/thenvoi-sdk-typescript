import { describe, expect, it, vi } from "vitest";

import { UnsupportedFeatureError } from "../src/core/errors";
import { FernRestAdapter } from "../src/client/rest/FernRestAdapter";

describe("FernRestAdapter coverage", () => {
  it("retries getAgentMe on 429s and then returns the normalized identity", async () => {
    const getAgentMe = vi.fn()
      .mockRejectedValueOnce(new Error("request failed (429)"))
      .mockResolvedValueOnce({ data: { id: "a1", name: "Agent", description: null, handle: "@agent" } });
    const adapter = new FernRestAdapter({
      agentApiIdentity: { getAgentMe },
    });

    await expect(adapter.getAgentMe()).resolves.toEqual({
      id: "a1",
      name: "Agent",
      description: null,
      handle: "@agent",
    });
    expect(getAgentMe).toHaveBeenCalledTimes(2);
  });

  it("falls back to legacy profile identity when agentApiIdentity is missing", async () => {
    const adapter = new FernRestAdapter({
      humanApiProfile: {
        getMyProfile: async () => ({
          data: {
            id: "legacy-1",
            first_name: "Legacy",
            last_name: "Agent",
            description: "legacy",
          },
        }),
      },
    });

    await expect(adapter.getAgentMe()).resolves.toEqual({
      id: "legacy-1",
      name: "Legacy Agent",
      description: "legacy",
      handle: null,
    });
  });

  it("throws when createChat returns no room id", async () => {
    const adapter = new FernRestAdapter({
      agentApiChats: {
        createAgentChat: async () => ({ data: {} }),
      },
    });

    await expect(adapter.createChat()).rejects.toThrow("Chat create response did not include id");
  });

  it("falls back from createChatEvent to createChatMessage when the event endpoint is unavailable", async () => {
    const createMyChatMessage = vi.fn(async () => ({ data: { ok: true } }));
    const adapter = new FernRestAdapter({
      myChatMessages: {
        createMyChatMessage,
      },
    });

    await expect(adapter.createChatEvent("room-1", {
      content: "hello",
      messageType: "task",
    })).resolves.toEqual({ ok: true });
    expect(createMyChatMessage).toHaveBeenCalledOnce();
  });

  it("normalizes listChatParticipants from the chatParticipants namespace", async () => {
    const adapter = new FernRestAdapter({
      chatParticipants: {
        listChatParticipants: async () => ({
          data: [
            { id: "u1", name: "Jane", type: "User", handle: "@jane" },
            { id: 42 },
          ],
        }),
      },
    });

    await expect(adapter.listChatParticipants("room-1")).resolves.toEqual([
      { id: "u1", name: "Jane", type: "User", handle: "@jane" },
    ]);
  });

  it("throws UnsupportedFeatureError when no next-message endpoint exists", async () => {
    const adapter = new FernRestAdapter({});
    await expect(adapter.getNextMessage({ chatId: "room-1" })).rejects.toBeInstanceOf(UnsupportedFeatureError);
  });
});
