import { describe, expect, it } from "vitest";

import { RestFacade } from "../src/client/rest/RestFacade";
import { ExecutionContext } from "../src/runtime/ExecutionContext";
import { FakeRestApi } from "./testUtils";

function makeContext(options?: { maxMessageRetries?: number }) {
  return new ExecutionContext({
    roomId: "room-1",
    link: { rest: new RestFacade({ api: new FakeRestApi() }) },
    maxContextMessages: 20,
    maxMessageRetries: options?.maxMessageRetries,
  });
}

describe("ExecutionContext enhancements", () => {
  describe("state tracking", () => {
    it("starts in 'starting' state", () => {
      const ctx = makeContext();
      expect(ctx.state).toBe("starting");
    });

    it("transitions through states", () => {
      const ctx = makeContext();
      ctx.setState("idle");
      expect(ctx.state).toBe("idle");
      ctx.setState("processing");
      expect(ctx.state).toBe("processing");
      ctx.setState("idle");
      expect(ctx.state).toBe("idle");
    });
  });

  describe("system message queue", () => {
    it("injects and consumes system messages", () => {
      const ctx = makeContext();
      ctx.injectSystemMessage("msg1");
      ctx.injectSystemMessage("msg2");

      const messages = ctx.consumeSystemMessages();
      expect(messages).toEqual(["msg1", "msg2"]);

      // Queue should be empty after consume
      expect(ctx.consumeSystemMessages()).toEqual([]);
    });

    it("returns independent copy on consume", () => {
      const ctx = makeContext();
      ctx.injectSystemMessage("msg1");

      const messages = ctx.consumeSystemMessages();
      ctx.injectSystemMessage("msg2");

      expect(messages).toEqual(["msg1"]);
      expect(ctx.consumeSystemMessages()).toEqual(["msg2"]);
    });
  });

  describe("LLM initialized tracking", () => {
    it("starts uninitialized", () => {
      const ctx = makeContext();
      expect(ctx.isLlmInitialized).toBe(false);
    });

    it("can be marked initialized", () => {
      const ctx = makeContext();
      ctx.markLlmInitialized();
      expect(ctx.isLlmInitialized).toBe(true);
    });

    it("consumeBootstrap returns true on first call and marks LLM initialized", () => {
      const ctx = makeContext();
      expect(ctx.isLlmInitialized).toBe(false);

      const first = ctx.consumeBootstrap();
      expect(first).toBe(true);
      expect(ctx.isLlmInitialized).toBe(true);

      const second = ctx.consumeBootstrap();
      expect(second).toBe(false);
    });
  });

  describe("backward compatibility", () => {
    it("setContactsMessage and consumeContactsMessage still work", () => {
      const ctx = makeContext();
      ctx.setContactsMessage("contact info");
      expect(ctx.consumeContactsMessage()).toBe("contact info");
      expect(ctx.consumeContactsMessage()).toBeNull();
    });
  });

  describe("retry tracker", () => {
    it("provides access to retry tracker", () => {
      const ctx = makeContext();
      const tracker = ctx.getRetryTracker();
      expect(tracker).toBeDefined();
      expect(tracker.maxRetries).toBe(1);
    });

    it("uses custom maxMessageRetries", () => {
      const ctx = makeContext({ maxMessageRetries: 3 });
      expect(ctx.getRetryTracker().maxRetries).toBe(3);
    });
  });
});
