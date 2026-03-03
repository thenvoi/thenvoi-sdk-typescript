import { Channel, Socket } from "phoenix";
import { TransportError } from "../../core/errors";
import type { Logger } from "../../core/logger";
import { NoopLogger } from "../../core/logger";
import type { StreamingTransport, TopicHandlers } from "./transport";

interface PhoenixChannelsTransportOptions {
  wsUrl: string;
  apiKey: string;
  agentId?: string;
  logger?: Logger;
  heartbeatIntervalMs?: number;
  reconnectAfterMs?: (tries: number) => number;
  websocketFactory?: typeof WebSocket;
}

export class PhoenixChannelsTransport implements StreamingTransport {
  private readonly socket: Socket;
  private readonly channels = new Map<string, Channel>();
  private readonly logger: Logger;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  public constructor(options: PhoenixChannelsTransportOptions) {
    this.logger = options.logger ?? new NoopLogger();

    this.socket = new Socket(options.wsUrl, {
      params: {
        token: options.apiKey,
        agent_id: options.agentId,
      },
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      reconnectAfterMs: options.reconnectAfterMs,
      transport: options.websocketFactory,
    });

    this.socket.onOpen(() => {
      this.connected = true;
      this.logger.info("Phoenix socket opened");
    });

    this.socket.onClose(() => {
      this.connected = false;
      this.logger.info("Phoenix socket closed");
    });

    this.socket.onError((event) => {
      this.logger.warn("Phoenix socket error", { event });
    });
  }

  public async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (!this.connectPromise) {
      this.socket.connect();
      this.connectPromise = this.waitForConnection();
    }

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  public async disconnect(): Promise<void> {
    for (const topic of this.channels.keys()) {
      await this.leave(topic);
    }

    this.socket.disconnect();
    this.connected = false;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async join(topic: string, handlers: TopicHandlers): Promise<void> {
    if (this.channels.has(topic)) {
      return;
    }

    const channel = this.socket.channel(topic, {});

    for (const [event, handler] of Object.entries(handlers)) {
      channel.on(event, (payload: Record<string, unknown>) => {
        try {
          void handler(payload);
        } catch (error) {
          this.logger.error("Unhandled topic handler error", {
            topic,
            event,
            error,
          });
        }
      });
    }

    await new Promise<void>((resolve, reject) => {
      channel
        .join()
        .receive("ok", () => resolve())
        .receive("error", (error: unknown) =>
          reject(new TransportError(`Failed to join topic ${topic}`, error)),
        )
        .receive("timeout", () => reject(new TransportError(`Timeout joining topic ${topic}`)));
    });

    this.channels.set(topic, channel);
    this.logger.debug("Joined topic", { topic });
  }

  public async leave(topic: string): Promise<void> {
    const channel = this.channels.get(topic);
    if (!channel) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      channel
        .leave()
        .receive("ok", () => resolve())
        .receive("error", (error: unknown) =>
          reject(new TransportError(`Failed to leave topic ${topic}`, error)),
        )
        .receive("timeout", () => reject(new TransportError(`Timeout leaving topic ${topic}`)));
    });

    this.channels.delete(topic);
    this.logger.debug("Left topic", { topic });
  }

  public async runForever(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return;
    }

    await new Promise<void>((resolve) => {
      signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  }

  private async waitForConnection(timeoutMs = 10_000): Promise<void> {
    const startedAt = Date.now();
    while (!this.connected) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw new TransportError("Timed out waiting for Phoenix socket connection");
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25);
      });
    }
  }
}
