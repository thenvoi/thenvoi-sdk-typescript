import type { AdapterToolsProtocol } from "../contracts/protocols";
import { mcpToolNames } from "../runtime/tools/schemas";
import type { McpToolRegistration } from "./registrations";
import { buildRoomScopedRegistrations } from "./registrations";
import {
  createThenvoiSdkMcpServer,
  type ThenvoiSdkMcpServer,
} from "./sdk";
import { ThenvoiMcpStdioServer } from "./stdio";
import { ThenvoiMcpServer } from "./server";
import { ThenvoiMcpSseServer } from "./sse";

export type ThenvoiMcpBackendKind = "sdk" | "http" | "sse" | "stdio";

export interface ThenvoiMcpBackend {
  kind: ThenvoiMcpBackendKind;
  server: unknown;
  allowedTools: string[];
  stop(): Promise<void>;
}

export interface CreateThenvoiMcpBackendOptions {
  kind: ThenvoiMcpBackendKind;
  enableMemoryTools: boolean;
  getToolsForRoom(roomId: string): AdapterToolsProtocol | undefined;
  additionalTools?: McpToolRegistration[];
}

export async function createThenvoiMcpBackend(
  options: CreateThenvoiMcpBackendOptions,
): Promise<ThenvoiMcpBackend> {
  const registrations = buildRoomScopedRegistrations(
    options.getToolsForRoom,
    {
      enableMemoryTools: options.enableMemoryTools,
      enableContactTools: true,
      additionalTools: options.additionalTools,
    },
  );

  const allowedTools = mcpToolNames(new Set(registrations.map((registration) => registration.name)));

  if (options.kind === "sdk") {
    const server = createThenvoiSdkMcpServer({
      enableMemoryTools: options.enableMemoryTools,
      getToolsForRoom: options.getToolsForRoom,
      additionalTools: options.additionalTools,
    });

    return {
      kind: "sdk",
      server,
      allowedTools: server.allowedTools,
      stop: async () => undefined,
    };
  }

  if (options.kind === "stdio") {
    const server = new ThenvoiMcpStdioServer({
      tools: options.getToolsForRoom,
      enableMemoryTools: options.enableMemoryTools,
      enableContactTools: true,
      additionalTools: options.additionalTools,
    });
    await server.start();

    return {
      kind: "stdio",
      server,
      allowedTools,
      stop: async () => {
        await server.stop();
      },
    };
  }

  if (options.kind === "sse") {
    const server = new ThenvoiMcpSseServer({
      tools: options.getToolsForRoom,
      enableMemoryTools: options.enableMemoryTools,
      enableContactTools: true,
      additionalTools: options.additionalTools,
    });
    await server.start();

    return {
      kind: "sse",
      server,
      allowedTools,
      stop: async () => {
        await server.stop();
      },
    };
  }

  const server = new ThenvoiMcpServer({
    tools: options.getToolsForRoom,
    enableMemoryTools: options.enableMemoryTools,
    enableContactTools: true,
    additionalTools: options.additionalTools,
  });
  await server.start();

  return {
    kind: "http",
    server,
    allowedTools,
    stop: async () => {
      await server.stop();
    },
  };
}

export function getThenvoiSdkMcpServerConfig(
  backend: ThenvoiMcpBackend,
): ThenvoiSdkMcpServer["serverConfig"] {
  if (backend.kind !== "sdk") {
    throw new Error(`Expected sdk MCP backend, received ${backend.kind}`);
  }

  return (backend.server as ThenvoiSdkMcpServer).serverConfig;
}
