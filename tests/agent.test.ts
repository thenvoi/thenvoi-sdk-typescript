import { describe, expect, it, vi } from "vitest";

import { Agent } from "../src/agent/Agent";

describe("Agent", () => {
  it("waits for startup to finish before honoring a stop request", async () => {
    let releaseStart!: () => void;
    const startGate = new Promise<void>((resolve) => {
      releaseStart = () => resolve();
    });
    const mockRuntime = {
      start: vi.fn(async () => {
        await startGate;
      }),
      stop: vi.fn(async () => true),
      runForever: vi.fn(async () => undefined),
      name: "test",
      description: "test",
      contactConfiguration: undefined,
      isContactsSubscribed: false,
    };
    const mockAdapter = {
      onEvent: vi.fn(async () => undefined),
      onStarted: vi.fn(async () => undefined),
      onCleanup: vi.fn(async () => undefined),
      onRuntimeStop: vi.fn(async () => undefined),
    };
    const agent = new Agent(mockRuntime as never, mockAdapter as never);

    const startPromise = agent.start();
    const stopPromise = agent.stop();

    expect(mockRuntime.stop).not.toHaveBeenCalled();

    releaseStart();
    await startPromise;
    await expect(stopPromise).resolves.toBe(true);

    expect(mockRuntime.stop).toHaveBeenCalledTimes(1);
  });

  it("does not invoke adapter onRuntimeStop outside PlatformRuntime.stop", async () => {
    const mockRuntime = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => true),
      runForever: vi.fn(async () => undefined),
      name: "test",
      description: "test",
      contactConfiguration: undefined,
      isContactsSubscribed: false,
    };
    const mockAdapter = {
      onEvent: vi.fn(async () => undefined),
      onStarted: vi.fn(async () => undefined),
      onCleanup: vi.fn(async () => undefined),
      onRuntimeStop: vi.fn(async () => undefined),
    };
    const agent = new Agent(mockRuntime as never, mockAdapter as never);

    await agent.start();
    await agent.stop();

    expect(mockRuntime.stop).toHaveBeenCalledTimes(1);
    expect(mockAdapter.onRuntimeStop).not.toHaveBeenCalled();
  });
});
