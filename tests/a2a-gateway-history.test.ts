import { describe, expect, it } from "vitest";

import { GatewayHistoryConverter } from "../src/adapters/a2a-gateway/history";

describe("GatewayHistoryConverter", () => {
  it("extracts context and participants from history", () => {
    const converter = new GatewayHistoryConverter();

    const state = converter.convert([
      {
        message_type: "task",
        room_id: "room-1",
        metadata: {
          gateway_context_id: "ctx-1",
          gateway_room_id: "room-1",
        },
      },
      {
        message_type: "text",
        room_id: "room-1",
        sender_type: "agent",
        sender_id: "peer-1",
      },
      {
        message_type: "text",
        room_id: "room-1",
        sender_type: "agent",
        sender_id: "peer-2",
      },
      {
        message_type: "text",
        room_id: "room-2",
        sender_type: "user",
        sender_id: "user-1",
      },
    ]);

    expect(state.contextToRoom).toEqual({
      "ctx-1": "room-1",
    });
    expect(state.roomParticipants["room-1"]).toEqual([
      "peer-1",
      "peer-2",
    ]);
    expect(state.roomParticipants["room-2"]).toBeUndefined();
  });

  it("uses message room fallback when metadata room is absent", () => {
    const converter = new GatewayHistoryConverter();

    const state = converter.convert([
      {
        room_id: "room-fallback",
        metadata: {
          gateway_context_id: "ctx-fallback",
        },
      },
    ]);

    expect(state.contextToRoom).toEqual({
      "ctx-fallback": "room-fallback",
    });
  });
});
