import { describe, expect, it, vi, afterEach } from "vitest";

import { Agent } from "../src/agent/Agent";
import { GracefulShutdown } from "../src/runtime/shutdown";

function makeAgent(stopMs = 0) {
  return {
    stop: vi.fn(async () => {
      if (stopMs > 0) {
        await new Promise((r) => setTimeout(r, stopMs));
      }
      return true;
    }),
    run: vi.fn(async () => {}),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GracefulShutdown", () => {
  it("registers and unregisters signal handlers", () => {
    const agent = makeAgent();
    const shutdown = new GracefulShutdown(agent as never);

    const onSpy = vi.spyOn(process, "on");
    const offSpy = vi.spyOn(process, "off");

    shutdown.registerSignals();
    expect(onSpy).toHaveBeenCalledTimes(3);
    expect(onSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith("SIGHUP", expect.any(Function));

    shutdown.unregisterSignals();
    expect(offSpy).toHaveBeenCalledTimes(3);
  });

  it("calls agent.stop when signal is received", async () => {
    const agent = makeAgent();
    const shutdown = new GracefulShutdown(agent as never, { timeoutMs: 5000 });

    shutdown.registerSignals();

    // Simulate SIGINT
    process.emit("SIGINT");

    // Give async shutdown a tick
    await new Promise((r) => setTimeout(r, 10));

    expect(agent.stop).toHaveBeenCalledWith(5000);

    shutdown.unregisterSignals();
  });

  it("only shuts down once even with multiple signals", async () => {
    const agent = makeAgent();
    const shutdown = new GracefulShutdown(agent as never);

    shutdown.registerSignals();

    process.emit("SIGINT");
    process.emit("SIGTERM");

    await new Promise((r) => setTimeout(r, 10));

    expect(agent.stop).toHaveBeenCalledTimes(1);

    shutdown.unregisterSignals();
  });

  it("calls onSignal callback", async () => {
    const agent = makeAgent();
    const onSignal = vi.fn();
    const shutdown = new GracefulShutdown(agent as never, { onSignal });

    shutdown.registerSignals();

    process.emit("SIGTERM");

    await new Promise((r) => setTimeout(r, 10));

    expect(onSignal).toHaveBeenCalledWith("SIGTERM");

    shutdown.unregisterSignals();
  });

  it("defaults timeout to 30 seconds", async () => {
    const agent = makeAgent();
    const shutdown = new GracefulShutdown(agent as never);

    shutdown.registerSignals();
    process.emit("SIGINT");

    await new Promise((r) => setTimeout(r, 10));

    expect(agent.stop).toHaveBeenCalledWith(30_000);

    shutdown.unregisterSignals();
  });

  it("withSignals registers and unregisters around function execution", async () => {
    const agent = makeAgent();
    const shutdown = new GracefulShutdown(agent as never);

    const onSpy = vi.spyOn(process, "on");
    const offSpy = vi.spyOn(process, "off");

    await shutdown.withSignals(async () => {
      expect(onSpy).toHaveBeenCalledTimes(3);
    });

    expect(offSpy).toHaveBeenCalledTimes(3);
  });

  it("withSignals unregisters even if function throws", async () => {
    const agent = makeAgent();
    const shutdown = new GracefulShutdown(agent as never);

    const offSpy = vi.spyOn(process, "off");

    await expect(
      shutdown.withSignals(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(offSpy).toHaveBeenCalledTimes(3);
  });
});

describe("Agent.run signal handling", () => {
  it("registers signal handlers by default", async () => {
    const mockRuntime = {
      start: vi.fn(),
      stop: vi.fn(async () => true),
      runForever: vi.fn(async () => {}),
      name: "test",
      description: "test",
      contactConfiguration: undefined,
      isContactsSubscribed: false,
    };
    const mockAdapter = {
      onEvent: vi.fn(),
      onStarted: vi.fn(),
      onCleanup: vi.fn(),
    };
    const agent = new Agent(mockRuntime as never, mockAdapter as never);

    const onSpy = vi.spyOn(process, "on");

    await agent.run();

    // Signal handlers should have been registered (3 signals) and then unregistered
    expect(onSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith("SIGHUP", expect.any(Function));
  });

  it("does not register signal handlers when signals: false", async () => {
    const mockRuntime = {
      start: vi.fn(),
      stop: vi.fn(async () => true),
      runForever: vi.fn(async () => {}),
      name: "test",
      description: "test",
      contactConfiguration: undefined,
      isContactsSubscribed: false,
    };
    const mockAdapter = {
      onEvent: vi.fn(),
      onStarted: vi.fn(),
      onCleanup: vi.fn(),
    };
    const agent = new Agent(mockRuntime as never, mockAdapter as never);

    const onSpy = vi.spyOn(process, "on");

    await agent.run({ signals: false });

    // No signal handlers should have been registered
    const signalCalls = onSpy.mock.calls.filter(
      ([event]) => event === "SIGINT" || event === "SIGTERM" || event === "SIGHUP",
    );
    expect(signalCalls).toHaveLength(0);
  });
});
