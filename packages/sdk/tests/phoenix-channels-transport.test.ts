import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransportError } from "../src/core/errors";

const phoenixMock = vi.hoisted(() => {
  type Outcome = "ok" | "error" | "timeout";

  class FakeChannel {
    public readonly topic: string;
    public readonly handlers = new Map<string, (payload: Record<string, unknown>) => void>();
    public joinOutcome: Outcome = "ok";
    public leaveOutcome: Outcome = "ok";
    private nextRef = 1;

    public constructor(topic: string) {
      this.topic = topic;
    }

    public on(event: string, handler: (payload: Record<string, unknown>) => void): number {
      this.handlers.set(event, handler);
      return this.nextRef++;
    }

    public off(_event: string, _ref?: number): void {
      // In a real implementation this would remove the specific handler
    }

    public onClose(_callback: () => void): void {}
    public onError(_callback: (reason?: unknown) => void): void {}

    public emit(event: string, payload: Record<string, unknown>): void {
      this.handlers.get(event)?.(payload);
    }

    public join(): {
      receive: (kind: Outcome, callback: (payload?: unknown) => void) => unknown;
    } {
      return this.receiver(this.joinOutcome);
    }

    public leave(): {
      receive: (kind: Outcome, callback: (payload?: unknown) => void) => unknown;
    } {
      return this.receiver(this.leaveOutcome);
    }

    private receiver(outcome: Outcome): {
      receive: (kind: Outcome, callback: (payload?: unknown) => void) => unknown;
    } {
      const chain = {
        receive: (kind: Outcome, callback: (payload?: unknown) => void) => {
          if (kind === outcome) {
            queueMicrotask(() => callback(kind === "ok" ? {} : { error: kind }));
          }
          return chain;
        },
      };
      return chain;
    }
  }

  class FakeSocket {
    public static readonly instances: FakeSocket[] = [];

    public readonly url: string;
    public readonly params: Record<string, unknown>;
    public readonly channels = new Map<string, FakeChannel>();
    private openHandler: (() => void) | null = null;
    private closeHandler: ((event?: { code?: number; reason?: string }) => void) | null = null;
    private errorHandler: ((payload: unknown) => void) | null = null;

    public constructor(url: string, options: { params: Record<string, unknown> }) {
      this.url = url;
      this.params = options.params;
      FakeSocket.instances.push(this);
    }

    public onOpen(handler: () => void): void {
      this.openHandler = handler;
    }

    public onClose(handler: (event?: { code?: number; reason?: string }) => void): void {
      this.closeHandler = handler;
    }

    public onError(handler: (payload: unknown) => void): void {
      this.errorHandler = handler;
    }

    public connect(): void {
      queueMicrotask(() => {
        this.openHandler?.();
      });
    }

    public disconnect(): void {
      this.closeHandler?.();
    }

    public emitClose(event?: { code?: number; reason?: string }): void {
      this.closeHandler?.(event);
    }

    public channel(topic: string): FakeChannel {
      const channel = new FakeChannel(topic);
      this.channels.set(topic, channel);
      return channel;
    }

    public emitError(payload: unknown): void {
      this.errorHandler?.(payload);
    }
  }

  return {
    FakeChannel,
    FakeSocket,
    reset: () => {
      FakeSocket.instances.splice(0, FakeSocket.instances.length);
    },
  };
});

vi.mock("phoenix", () => ({
  Channel: phoenixMock.FakeChannel,
  Socket: phoenixMock.FakeSocket,
}));

import { PhoenixChannelsTransport } from "../src/platform/streaming/PhoenixChannelsTransport";

describe("PhoenixChannelsTransport", () => {
  beforeEach(() => {
    phoenixMock.reset();
  });

  it("normalizes websocket URL and connects once", async () => {
    const transport = new PhoenixChannelsTransport({
      wsUrl: "wss://example.test/socket/websocket",
      apiKey: "key-1",
      agentId: "agent-1",
    });

    const socket = phoenixMock.FakeSocket.instances[0];
    expect(socket?.url).toBe("wss://example.test/socket");

    await transport.connect();
    await transport.connect();
    expect(transport.isConnected()).toBe(true);
  });

  it("joins and leaves topics and dispatches topic handlers", async () => {
    const onMessage = vi.fn(async () => {});
    const transport = new PhoenixChannelsTransport({
      wsUrl: "wss://example.test/socket",
      apiKey: "key-1",
    });
    await transport.connect();

    await transport.join("room:1", { message: onMessage });
    const socket = phoenixMock.FakeSocket.instances[0];
    const channel = socket?.channels.get("room:1");
    channel?.emit("message", { body: "hello" });

    expect(onMessage).toHaveBeenCalledWith({ body: "hello" });

    await transport.leave("room:1");
    await expect(transport.leave("room:1")).resolves.toBeUndefined();
  });

  it("wraps join failures in TransportError", async () => {
    const transport = new PhoenixChannelsTransport({
      wsUrl: "wss://example.test/socket",
      apiKey: "key-1",
    });
    await transport.connect();

    const socket = phoenixMock.FakeSocket.instances[0];
    if (socket) {
      const originalChannel = socket.channel.bind(socket);
      socket.channel = (topic: string) => {
        const channel = originalChannel(topic);
        channel.joinOutcome = "error";
        return channel;
      };
    }

    await expect(
      transport.join("room:error", {
        message: async () => {},
      }),
    ).rejects.toBeInstanceOf(TransportError);
  });

  it("fires disconnect handler with parsed reason on socket close", async () => {
    const disconnectEvents: Array<{ code: number | null; reason: string; rawReason: string | null }> = [];
    const transport = new PhoenixChannelsTransport({
      wsUrl: "wss://example.test/socket",
      apiKey: "key-1",
    });
    transport.setDisconnectHandler((info) => {
      disconnectEvents.push(info);
    });

    await transport.connect();

    const socket = phoenixMock.FakeSocket.instances[0];
    socket?.emitClose({ code: 1000, reason: "duplicate_agent" });

    expect(disconnectEvents).toHaveLength(1);
    expect(disconnectEvents[0]?.reason).toContain("Another instance of this agent connected");
    expect(disconnectEvents[0]?.rawReason).toBe("duplicate_agent");
    expect(disconnectEvents[0]?.code).toBe(1000);
  });

  it("fires disconnect handler with code-only reason when no server reason", async () => {
    const disconnectEvents: Array<{ code: number | null; reason: string; rawReason: string | null }> = [];
    const transport = new PhoenixChannelsTransport({
      wsUrl: "wss://example.test/socket",
      apiKey: "key-1",
    });
    transport.setDisconnectHandler((info) => {
      disconnectEvents.push(info);
    });

    await transport.connect();

    const socket = phoenixMock.FakeSocket.instances[0];
    socket?.emitClose({ code: 1006 });

    expect(disconnectEvents).toHaveLength(1);
    expect(disconnectEvents[0]?.reason).toBe("Abnormal closure — no close frame received");
    expect(disconnectEvents[0]?.rawReason).toBeNull();
  });

  it("does not fire disconnect handler on intentional disconnect", async () => {
    const disconnectEvents: Array<{ code: number | null; reason: string; rawReason: string | null }> = [];
    const transport = new PhoenixChannelsTransport({
      wsUrl: "wss://example.test/socket",
      apiKey: "key-1",
    });
    transport.setDisconnectHandler((info) => {
      disconnectEvents.push(info);
    });

    await transport.connect();
    await transport.disconnect();

    expect(disconnectEvents).toHaveLength(0);
  });

  it("fires disconnect handler with generic message when no close info", async () => {
    const disconnectEvents: Array<{ code: number | null; reason: string; rawReason: string | null }> = [];
    const transport = new PhoenixChannelsTransport({
      wsUrl: "wss://example.test/socket",
      apiKey: "key-1",
    });
    transport.setDisconnectHandler((info) => {
      disconnectEvents.push(info);
    });

    await transport.connect();

    const socket = phoenixMock.FakeSocket.instances[0];
    socket?.emitClose();

    expect(disconnectEvents).toHaveLength(1);
    expect(disconnectEvents[0]?.reason).toBe("Connection lost unexpectedly");
  });
});
