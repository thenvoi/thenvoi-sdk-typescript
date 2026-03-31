import { describe, expect, it } from "vitest";

import {
  messageCreatedPayloadSchema,
  payloadSchemas,
} from "../src/platform/streaming/payloadSchemas";

describe("payloadSchemas", () => {
  it("parses message_created payloads with optional metadata", () => {
    const parsed = messageCreatedPayloadSchema.parse({
      id: "m1",
      content: "hello",
      message_type: "text",
      metadata: {
        mentions: [{ id: "u1", handle: "@user1" }],
      },
      sender_id: "u1",
      sender_type: "User",
      sender_name: "User 1",
      chat_room_id: "room-1",
      inserted_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    expect(parsed.metadata?.mentions?.[0]?.id).toBe("u1");
  });

  it("exposes schemas for all supported socket event names", () => {
    expect(payloadSchemas.message_created).toBeDefined();
    expect(payloadSchemas.room_added).toBeDefined();
    expect(payloadSchemas.contact_removed).toBeDefined();
  });
});
