declare module "phoenix" {
  export interface Push {
    receive(
      status: "ok" | "error" | "timeout",
      callback: (response?: unknown) => void,
    ): Push;
  }

  export class Channel {
    on(event: string, callback: (payload: Record<string, unknown>) => void): number;
    off(event: string, ref?: number): void;
    join(): Push;
    leave(): Push;
    // Note: some Phoenix.js versions pass arguments to these callbacks, but we
    // don't rely on them yet.  Update the signatures here if channel-level
    // close reasons are needed in the future.
    onClose(callback: () => void): void;
    onError(callback: (reason?: unknown) => void): void;
  }

  export interface SocketOptions {
    params?: Record<string, unknown>;
    heartbeatIntervalMs?: number;
    reconnectAfterMs?: (tries: number) => number;
    transport?: typeof WebSocket;
  }

  export class Socket {
    constructor(url: string, options?: SocketOptions);
    channel(topic: string, params?: Record<string, unknown>): Channel;
    connect(): void;
    disconnect(): void;
    onOpen(callback: () => void): number;
    onClose(callback: (event?: { code?: number; reason?: string }) => void): number;
    onError(callback: (event: unknown) => void): number;
  }
}
