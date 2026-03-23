import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import { z, type ZodTypeAny } from "zod";

import type { AdapterToolsProtocol } from "../../contracts/protocols";
import {
  buildRoomScopedRegistrations,
  type McpToolRegistration,
} from "../../mcp/registrations";
import { mcpToolNames } from "../../runtime/tools/schemas";

interface CreateThenvoiMcpBridgeOptions {
  enableMemoryTools: boolean;
  getToolsForRoom(roomId: string): AdapterToolsProtocol | undefined;
  additionalTools?: McpToolRegistration[];
}

export interface ThenvoiMcpBridge {
  serverConfig: McpSdkServerConfigWithInstance;
  allowedTools: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches SDK's own SdkMcpToolDefinition<any> signature
  toolDefinitions: Array<SdkMcpToolDefinition<any>>;
}

export function createThenvoiMcpBridge(
  options: CreateThenvoiMcpBridgeOptions,
): ThenvoiMcpBridge {
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
  const shape: Record<string, ZodTypeAny> = {};
  const requiredSet = new Set(registration.inputSchema.required);

  for (const [propertyName, propertySchema] of Object.entries(registration.inputSchema.properties)) {
    const validator = toZodValidator(propertySchema as Record<string, unknown>);
    shape[propertyName] = requiredSet.has(propertyName) ? validator : validator.optional();
  }

  return tool(
    registration.name,
    registration.description,
    shape,
    async (args: Record<string, unknown>) => registration.execute(args),
  );
}

function toZodValidator(schema: Record<string, unknown>): ZodTypeAny {
  const type = schema.type;
  if (type === "string") {
    if (Array.isArray(schema.enum) && schema.enum.every((value) => typeof value === "string")) {
      const values = schema.enum;
      if (values.length > 0) {
        return z.enum(values as [string, ...string[]]);
      }
    }
    return z.string();
  }

  if (type === "integer" || type === "number") {
    return z.number();
  }

  if (type === "boolean") {
    return z.boolean();
  }

  if (type === "array") {
    const itemSchema = schema.items;
    if (itemSchema && typeof itemSchema === "object") {
      return z.array(toZodValidator(itemSchema as Record<string, unknown>));
    }
    return z.array(z.unknown());
  }

  if (type === "object") {
    return z.record(z.string(), z.unknown());
  }

  return z.unknown();
}
