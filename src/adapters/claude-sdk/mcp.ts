import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import { z, type ZodTypeAny } from "zod";

import type { AdapterToolsProtocol } from "../../contracts/protocols";
import { toWireString } from "../shared/coercion";
import {
  BASE_TOOL_NAMES,
  MEMORY_TOOL_NAMES,
  TOOL_MODELS,
  getToolDescription,
  mcpToolNames,
} from "../../runtime/tools/schemas";

interface CreateThenvoiMcpBridgeOptions {
  enableMemoryTools: boolean;
  getToolsForRoom(roomId: string): AdapterToolsProtocol | undefined;
}

export interface ThenvoiMcpBridge {
  serverConfig: McpSdkServerConfigWithInstance;
  allowedTools: string[];
  toolDefinitions: SdkMcpToolDefinition[];
}

export function createThenvoiMcpBridge(
  options: CreateThenvoiMcpBridgeOptions,
): ThenvoiMcpBridge {
  const toolNames = new Set<string>([...BASE_TOOL_NAMES]);
  if (options.enableMemoryTools) {
    for (const name of MEMORY_TOOL_NAMES) {
      toolNames.add(name);
    }
  }

  const toolDefinitions: SdkMcpToolDefinition[] = [];
  for (const toolName of toolNames) {
    const model = TOOL_MODELS[toolName as keyof typeof TOOL_MODELS];
    if (!model) {
      continue;
    }

    const required = new Set<string>([
      ...model.required,
      "room_id",
    ]);
    const shape: Record<string, ZodTypeAny> = {
      room_id: z.string(),
    };

    for (const [propertyName, propertySchema] of Object.entries(model.properties)) {
      const validator = toZodValidator(propertySchema as Record<string, unknown>);
      shape[propertyName] = required.has(propertyName) ? validator : validator.optional();
    }

    toolDefinitions.push(
      tool(
        toolName,
        getToolDescription(toolName),
        shape,
        async (args) => {
          const roomId = asRoomId(args.room_id);
          if (!roomId) {
            return asErrorResult("Missing required room_id");
          }

          const roomTools = options.getToolsForRoom(roomId);
          if (!roomTools) {
            return asErrorResult(`No tool context found for room_id ${roomId}`);
          }

          const toolArgs = { ...args } as Record<string, unknown>;
          delete toolArgs.room_id;

          try {
            const result = await roomTools.executeToolCall(toolName, toolArgs);
            return asSuccessResult(result);
          } catch (error) {
            return asErrorResult(error instanceof Error ? error.message : String(error));
          }
        },
      ),
    );
  }

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

function asRoomId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toZodValidator(schema: Record<string, unknown>): ZodTypeAny {
  const type = schema.type;
  if (type === "string") {
    if (Array.isArray(schema.enum) && schema.enum.every((value) => typeof value === "string")) {
      const values = schema.enum as string[];
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

function asSuccessResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: toWireString(value),
      },
    ],
  };
}

function asErrorResult(message: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [
      {
        type: "text",
        text: message,
      },
    ],
    isError: true,
  };
}
