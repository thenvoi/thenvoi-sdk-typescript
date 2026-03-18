import { describe, expect, it, vi } from "vitest";

import { PlatformRuntime } from "../src/runtime/PlatformRuntime";
import { RuntimeStateError } from "../src/core/errors";
import { ThenvoiLink } from "../src/platform/ThenvoiLink";
import type { StreamingTransport } from "../src/platform/streaming/transport";
import { FakeRestApi } from "./testUtils";

class MinimalTransport implements StreamingTransport {
  public async connect() {}
  public async disconnect() {}
  public async join() {}
  public async leave() {}
  public async runForever() {}
  public isConnected() {
    return true;
  }
}

describe("PlatformRuntime coverage", () => {
  it("uses configured identity without calling getAgentMe", async () => {
    const getAgentMe = vi.fn(async () => ({ id: "a1", name: "Fetched", description: "Fetched desc" }));
    const runtime = new PlatformRuntime({
      agentId: "a1",
      apiKey: "k",
      link: new ThenvoiLink({
        agentId: "a1",
        apiKey: "k",
        transport: new MinimalTransport(),
        restApi: new FakeRestApi({ getAgentMe }),
      }),
      identity: {
        name: "Configured",
        description: "Configured desc",
      },
    });

    await runtime.initialize();

    expect(runtime.name).toBe("Configured");
    expect(runtime.description).toBe("Configured desc");
    expect(getAgentMe).not.toHaveBeenCalled();
  });

  it("throws when runForever, bootstrapRoomMessage, or resetRoomSession are called before start", async () => {
    const runtime = new PlatformRuntime({
      agentId: "a1",
      apiKey: "k",
      link: new ThenvoiLink({
        agentId: "a1",
        apiKey: "k",
        transport: new MinimalTransport(),
        restApi: new FakeRestApi(),
      }),
    });

    await expect(runtime.runForever()).rejects.toBeInstanceOf(RuntimeStateError);
    await expect(runtime.bootstrapRoomMessage("room-1", {
      id: "m1",
      roomId: "room-1",
      content: "hi",
      senderId: "u1",
      senderType: "User",
      senderName: "User",
      messageType: "text",
      metadata: {},
      createdAt: new Date(),
    })).rejects.toBeInstanceOf(RuntimeStateError);
    await expect(runtime.resetRoomSession("room-1")).rejects.toBeInstanceOf(RuntimeStateError);
  });

  it("aggregates runtime and adapter cleanup failures during stop", async () => {
    const runtime = new PlatformRuntime({
      agentId: "a1",
      apiKey: "k",
      link: new ThenvoiLink({
        agentId: "a1",
        apiKey: "k",
        transport: new MinimalTransport(),
        restApi: new FakeRestApi(),
      }),
    });

    (runtime as unknown as {
      runtime: { stop(timeoutMs?: number): Promise<boolean> };
      activeAdapter: { onRuntimeStop?: () => Promise<void> };
      stopping: boolean;
    }).runtime = {
      stop: async () => {
        throw new Error("runtime stop failed");
      },
    };
    (runtime as unknown as {
      runtime: { stop(timeoutMs?: number): Promise<boolean> };
      activeAdapter: { onRuntimeStop?: () => Promise<void> };
      stopping: boolean;
    }).activeAdapter = {
      onRuntimeStop: async () => {
        throw new Error("adapter cleanup failed");
      },
    };

    await expect(runtime.stop()).rejects.toThrow(
      "PlatformRuntime stop failed and adapter cleanup also failed",
    );
  });
});
