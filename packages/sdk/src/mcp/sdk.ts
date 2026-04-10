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
  buildSingleContextRegistrations,
  resolveSingleRoomTools,
  type McpToolRegistration,
} from "./registrations";
import { buildZodShape } from "./zod";

export interface CreateThenvoiSdkMcpServerOptions {
  enableMemoryTools: boolean;
  /**
   * Returns the tools for a given room. In single-room mode (`multiRoom: false`),
   * called once during init with `""` — must return the tools instance regardless of the argument.
   */
  getToolsForRoom: (roomId: string) => AdapterToolsProtocol | undefined;
  additionalTools?: McpToolRegistration[];
  multiRoom?: boolean;
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
  const registrationOptions = {
    enableMemoryTools: options.enableMemoryTools,
    enableContactTools: true,
    additionalTools: options.additionalTools,
  };

  const registrations = options.multiRoom === false
    ? buildSingleContextRegistrations(resolveSingleRoomTools(options.getToolsForRoom), registrationOptions)
    : buildRoomScopedRegistrations(options.getToolsForRoom, registrationOptions);

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
