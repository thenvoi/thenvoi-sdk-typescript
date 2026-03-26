import type { AgentSideConnection } from "@agentclientprotocol/sdk";

/**
 * Handler for vendor-specific ACP extension methods and notifications.
 *
 * Extension methods/notifications are not part of the core ACP specification.
 * Each client (Cursor, VS Code, etc.) may define its own set of extensions.
 * Implementations of this interface encapsulate client-specific behavior so
 * that ACPServer stays focused on the standard protocol.
 */
export interface ACPExtensionHandler {
  extMethod?(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;

  extNotification?(
    method: string,
    params: Record<string, unknown>,
    context: {
      sessionId: string;
      connection: AgentSideConnection;
    },
  ): Promise<void>;
}
