import type { DisconnectHandler } from "./disconnect";

export interface TopicHandlers {
  [event: string]: (payload: Record<string, unknown>) => Promise<void> | void;
}

export interface StreamingTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  join(topic: string, handlers: TopicHandlers): Promise<void>;
  leave(topic: string): Promise<void>;
  runForever(signal: AbortSignal): Promise<void>;
  isConnected(): boolean;
  /**
   * Register a callback for unexpected (non-intentional) disconnects.
   * Calling this again replaces the previous handler.
   * Optional — transports that don't support disconnect notification can omit this.
   */
  setDisconnectHandler?(handler: DisconnectHandler): void;
}
