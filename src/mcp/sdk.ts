import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { AdapterToolsProtocol } from "../contracts/protocols";
import { mcpToolNames } from "../runtime/tools/schemas";
import {
  buildRoomScopedRegistrations,
  type McpToolRegistration,
} from "./registrations";
import { buildZodShape } from "./zod";

export interface CreateThenvoiSdkMcpServerOptions {
  enableMemoryTools: boolean;
  getToolsForRoom: (roomId: string) => AdapterToolsProtocol | undefined;
  additionalTools?: McpToolRegistration[];
}

export interface ThenvoiSdkMcpServer {
  serverConfig: McpSdkServerConfigWithInstance;
  allowedTools: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches SDK's own SdkMcpToolDefinition<any> signature
  toolDefinitions: Array<SdkMcpToolDefinition<any>>;
}

export function createThenvoiSdkMcpServer(
  options: CreateThenvoiSdkMcpServerOptions,
): ThenvoiSdkMcpServer {
  const registrations = buildRoomScopedRegistrations(
    options.getToolsForRoom,
    {
      enableMemoryTools: options.enableMemoryTools,
      enableContactTools: true,
      additionalTools: options.additionalTools,
    },
  );

  const toolDefinitions = registrations.map(toSdkToolDefinition);
  const toolNames = new Set(registrations.map((r) => r.name));

  const serverConfig = createSdkMcpServer({
    name: "thenvoi",
    tools: toolDefinitions,
  });

  return {
    serverConfig,
    allowedTools: mcpToolNames(toolNames),
    toolDefinitions,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches SDK's own SdkMcpToolDefinition<any> signature
function toSdkToolDefinition(registration: McpToolRegistration): SdkMcpToolDefinition<any> {
  const shape = buildZodShape(
    z,
    registration.inputSchema.properties,
    new Set(registration.inputSchema.required),
  );

  return tool(
    registration.name,
    registration.description,
    shape,
    async (args: Record<string, unknown>) => registration.execute(args),
  );
}
