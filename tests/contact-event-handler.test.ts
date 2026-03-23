import { describe, expect, it, vi } from "vitest";

import {
  ContactEventHandler,
  ContactEventHandlerError,
  HUB_ROOM_SYSTEM_PROMPT,
} from "../src/runtime/ContactEventHandler";
import type { ContactEvent, MessageEvent } from "../src/platform/events";
import type { ContactEventConfig } from "../src/runtime/types";
import { FakeTools } from "./testUtils";

function makeRest() {
  return {
    createChat: vi.fn().mockResolvedValue({ id: "hub-room-1" }),
    createChatEvent: vi.fn().mockResolvedValue({}),
  };
}

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeContactRequestReceived(id = "req-1"): ContactEvent {
  return {
    type: "contact_request_received",
    roomId: null,
    payload: {
      id,
      from_handle: "alice",
      from_name: "Alice",
      message: "Hello!",
      status: "pending",
      inserted_at: new Date().toISOString(),
    },
  };
}

function makeContactRequestUpdated(id = "req-1", status = "accepted"): ContactEvent {
  return {
    type: "contact_request_updated",
    roomId: null,
    payload: { id, status },
  };
}

function makeContactAdded(id = "contact-1"): ContactEvent {
  return {
    type: "contact_added",
    roomId: null,
    payload: {
      id,
      handle: "alice",
      name: "Alice",
      type: "User",
      inserted_at: new Date().toISOString(),
    },
  };
}

function makeContactRemoved(id = "contact-1"): ContactEvent {
  return {
    type: "contact_removed",
    roomId: null,
    payload: { id },
  };
}

describe("ContactEventHandler", () => {
  describe("disabled strategy", () => {
    it("ignores events when strategy is disabled", async () => {
      const onBroadcast = vi.fn();
      const handler = new ContactEventHandler({
        config: { strategy: "disabled" },
        rest: makeRest(),
        onBroadcast,
      });

      await handler.handle(makeContactAdded());
      expect(onBroadcast).not.toHaveBeenCalled();
    });
  });

  describe("callback strategy", () => {
    it("calls onEvent callback with event and tools", async () => {
      const onEvent = vi.fn().mockResolvedValue(undefined);
      const tools = new FakeTools();
      const config: ContactEventConfig = { strategy: "callback", onEvent };
      const handler = new ContactEventHandler({ config, rest: makeRest() });

      const event = makeContactAdded();
      await handler.handle(event, tools);

      expect(onEvent).toHaveBeenCalledWith(event, tools);
    });

    it("rethrows callback errors with retry signal and deterministic logging", async () => {
      const onEvent = vi.fn().mockRejectedValue(new Error("callback failed"));
      const tools = new FakeTools();
      const logger = makeLogger();
      const config: ContactEventConfig = { strategy: "callback", onEvent };
      const handler = new ContactEventHandler({ config, rest: makeRest(), logger });

      await expect(handler.handle(makeContactAdded(), tools)).rejects.toMatchObject({
        name: "ContactEventHandlerError",
        stage: "callback",
        retryable: false,
        eventType: "contact_added",
      });
      expect(logger.error).toHaveBeenCalledWith(
        "contact_event.failure",
        expect.objectContaining({
          type: "contact_added",
          stage: "callback",
          retryable: false,
          error: expect.objectContaining({
            name: "Error",
            message: "callback failed",
          }),
        }),
      );
    });
  });

  describe("hub_room strategy", () => {
    it("creates hub room and pushes synthetic event", async () => {
      const rest = makeRest();
      const hubEvents: Array<{ roomId: string; event: MessageEvent }> = [];
      const hubInits: Array<{ roomId: string; prompt: string }> = [];

      const handler = new ContactEventHandler({
        config: { strategy: "hub_room", hubTaskId: "task-1" },
        rest,
        onHubEvent: async (roomId, event) => {
          hubEvents.push({ roomId, event });
        },
        onHubInit: async (roomId, prompt) => {
          hubInits.push({ roomId, prompt });
        },
      });

      await handler.handle(makeContactRequestReceived());

      expect(rest.createChat).toHaveBeenCalledWith("task-1");
      expect(rest.createChatEvent).toHaveBeenCalled();
      expect(hubEvents).toHaveLength(1);
      expect(hubEvents[0].roomId).toBe("hub-room-1");
      expect(hubInits).toHaveLength(1);
      expect(hubInits[0].prompt).toBe(HUB_ROOM_SYSTEM_PROMPT);
    });

    it("reuses existing hub room on subsequent events", async () => {
      const rest = makeRest();
      const handler = new ContactEventHandler({
        config: { strategy: "hub_room", hubTaskId: "task-1" },
        rest,
      });

      await handler.handle(makeContactRequestReceived("req-1"));
      await handler.handle(makeContactAdded("contact-1"));

      expect(rest.createChat).toHaveBeenCalledTimes(1);
      expect(rest.createChatEvent).toHaveBeenCalledTimes(2);
    });

    it("throws persist failures but still attempts hub dispatch", async () => {
      const rest = makeRest();
      const logger = makeLogger();
      const onHubEvent = vi.fn().mockResolvedValue(undefined);
      rest.createChatEvent.mockRejectedValueOnce(Object.assign(new Error("persist failed"), { retryable: true }));

      const handler = new ContactEventHandler({
        config: { strategy: "hub_room", hubTaskId: "task-1" },
        rest,
        onHubEvent,
        logger,
      });

      await expect(handler.handle(makeContactRequestReceived())).rejects.toMatchObject({
        name: "ContactEventHandlerError",
        stage: "hub_room_persist",
        retryable: true,
        eventType: "contact_request_received",
      });
      expect(onHubEvent).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        "contact_event.failure",
        expect.objectContaining({
          type: "contact_request_received",
          stage: "hub_room_persist",
          retryable: true,
        }),
      );
    });

    it("throws dispatch failures with retryable signal", async () => {
      const rest = makeRest();
      const logger = makeLogger();
      const onHubEvent = vi.fn().mockRejectedValueOnce(new Error("dispatch failed"));

      const handler = new ContactEventHandler({
        config: { strategy: "hub_room", hubTaskId: "task-1" },
        rest,
        onHubEvent,
        logger,
      });

      await expect(handler.handle(makeContactRequestReceived())).rejects.toMatchObject({
        name: "ContactEventHandlerError",
        stage: "hub_room_dispatch",
        retryable: true,
        eventType: "contact_request_received",
      });
      expect(rest.createChatEvent).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        "contact_event.failure",
        expect.objectContaining({
          type: "contact_request_received",
          stage: "hub_room_dispatch",
          retryable: true,
        }),
      );
    });
  });

  describe("deduplication", () => {
    it("skips duplicate events", async () => {
      const rest = makeRest();
      const handler = new ContactEventHandler({
        config: { strategy: "hub_room", hubTaskId: "task-1" },
        rest,
      });

      await handler.handle(makeContactAdded("c1"));
      await handler.handle(makeContactAdded("c1"));

      // Only one event should have been persisted (after room creation)
      expect(rest.createChatEvent).toHaveBeenCalledTimes(1);
    });

    it("allows same request with different statuses", async () => {
      const rest = makeRest();
      const handler = new ContactEventHandler({
        config: { strategy: "hub_room", hubTaskId: "task-1" },
        rest,
      });

      await handler.handle(makeContactRequestUpdated("req-1", "accepted"));
      await handler.handle(makeContactRequestUpdated("req-1", "rejected"));

      expect(rest.createChatEvent).toHaveBeenCalledTimes(2);
    });

    it("evicts oldest entries when LRU limit is reached", async () => {
      const rest = makeRest();
      const handler = new ContactEventHandler({
        config: { strategy: "hub_room", hubTaskId: "task-1" },
        rest,
      });

      // Fill dedup cache beyond limit (1000)
      for (let i = 0; i < 1001; i++) {
        await handler.handle(makeContactAdded(`contact-${i}`));
      }

      // The first entry should have been evicted, so re-sending should work
      rest.createChatEvent.mockClear();
      await handler.handle(makeContactAdded("contact-0"));
      expect(rest.createChatEvent).toHaveBeenCalledTimes(1);
    });

    it("allows retry of same event after a handling failure", async () => {
      const rest = makeRest();
      rest.createChatEvent.mockRejectedValueOnce(new Error("transient failure")).mockResolvedValueOnce({});
      const handler = new ContactEventHandler({
        config: { strategy: "hub_room", hubTaskId: "task-1" },
        rest,
      });

      await expect(handler.handle(makeContactAdded("retry-me"))).rejects.toBeInstanceOf(ContactEventHandlerError);
      await expect(handler.handle(makeContactAdded("retry-me"))).resolves.toBeUndefined();
      expect(rest.createChatEvent).toHaveBeenCalledTimes(2);
    });
  });

  describe("request cache enrichment", () => {
    it("enriches contact_request_updated with cached sender info", async () => {
      const handler = new ContactEventHandler({
        config: { strategy: "hub_room", hubTaskId: "task-1" },
        rest: makeRest(),
      });

      // First, receive the request to populate cache
      await handler.handle(makeContactRequestReceived("req-1"));

      const formatted = handler.formatEventMessage(makeContactRequestUpdated("req-1", "accepted"));
      expect(formatted).toContain("Alice");
      expect(formatted).toContain("@alice");
      expect(formatted).toContain("accepted");
    });

    it("falls back to ID when cache miss", () => {
      const handler = new ContactEventHandler({
        config: { strategy: "hub_room", hubTaskId: "task-1" },
        rest: makeRest(),
      });

      const formatted = handler.formatEventMessage(makeContactRequestUpdated("req-99", "rejected"));
      expect(formatted).toContain("req-99");
      expect(formatted).toContain("rejected");
    });
  });

  describe("broadcast", () => {
    it("broadcasts contact_added and contact_removed events", async () => {
      const onBroadcast = vi.fn();
      const handler = new ContactEventHandler({
        config: { strategy: "callback", broadcastChanges: true, onEvent: vi.fn() },
        rest: makeRest(),
        onBroadcast,
      });

      await handler.handle(makeContactAdded(), new FakeTools());
      await handler.handle(makeContactRemoved(), new FakeTools());

      expect(onBroadcast).toHaveBeenCalledTimes(2);
      expect(onBroadcast.mock.calls[0][0]).toContain("[Contacts]:");
      expect(onBroadcast.mock.calls[0][0]).toContain("is now a contact");
      expect(onBroadcast.mock.calls[1][0]).toContain("[Contacts]:");
      expect(onBroadcast.mock.calls[1][0]).toContain("was removed");
    });

    it("does not broadcast contact_request events", async () => {
      const onBroadcast = vi.fn();
      const handler = new ContactEventHandler({
        config: { strategy: "callback", broadcastChanges: true, onEvent: vi.fn() },
        rest: makeRest(),
        onBroadcast,
      });

      await handler.handle(makeContactRequestReceived(), new FakeTools());
      expect(onBroadcast).not.toHaveBeenCalled();
    });
  });

  describe("event formatting", () => {
    it("formats contact_request_received", () => {
      const handler = new ContactEventHandler({
        config: { strategy: "disabled" },
        rest: makeRest(),
      });

      const msg = handler.formatEventMessage(makeContactRequestReceived());
      expect(msg).toContain("Alice");
      expect(msg).toContain("@alice");
      expect(msg).toContain('Message: "Hello!"');
    });

    it("formats contact_added", () => {
      const handler = new ContactEventHandler({
        config: { strategy: "disabled" },
        rest: makeRest(),
      });

      const msg = handler.formatEventMessage(makeContactAdded());
      expect(msg).toContain("Contact added");
      expect(msg).toContain("Alice");
    });

    it("formats contact_removed", () => {
      const handler = new ContactEventHandler({
        config: { strategy: "disabled" },
        rest: makeRest(),
      });

      const msg = handler.formatEventMessage(makeContactRemoved());
      expect(msg).toContain("Contact removed");
      expect(msg).toContain("contact-1");
    });
  });
});
