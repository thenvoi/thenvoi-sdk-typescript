import type {
  ToolCall,
  ToolCallingModel,
  ToolCallingModelRequest,
  ToolCallingResponse,
} from "../tool-calling";
import { UnsupportedFeatureError } from "../../core/errors";
import { LazyAsyncValue } from "../shared/lazyAsyncValue";
import { toDisplayText } from "../shared/coercion";
import { mapConversationMessages, normalizeConversationRole } from "../tool-calling/valueUtils";

interface AISDKToolDefinition {
  description?: string;
  inputSchema: Record<string, unknown>;
}

type AISDKGenerateText = (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
type AISDKToolFactory = (definition: AISDKToolDefinition) => unknown;

interface AISDKRuntime {
  generateText: AISDKGenerateText;
  tool: AISDKToolFactory;
}

export interface AISDKToolCallingModelOptions {
  model: unknown;
  generateText?: AISDKGenerateText;
  toolFactory?: AISDKToolFactory;
}

export class AISDKToolCallingModel implements ToolCallingModel {
  private readonly model: unknown;
  private readonly generateTextOverride?: AISDKGenerateText;
  private readonly toolFactoryOverride?: AISDKToolFactory;
  private readonly runtimeLoader: LazyAsyncValue<AISDKRuntime>;

  public constructor(options: AISDKToolCallingModelOptions) {
    this.model = options.model;
    this.generateTextOverride = options.generateText;
    this.toolFactoryOverride = options.toolFactory;
    this.runtimeLoader = new LazyAsyncValue({
      load: async () => {
        if (this.generateTextOverride && this.toolFactoryOverride) {
          return {
            generateText: this.generateTextOverride,
            tool: this.toolFactoryOverride,
          };
        }

        const runtime = await loadAISDKRuntime();
        return {
          generateText: this.generateTextOverride ?? runtime.generateText,
          tool: this.toolFactoryOverride ?? runtime.tool,
        };
      },
    });
  }

  public async complete(request: ToolCallingModelRequest): Promise<ToolCallingResponse> {
    const runtime = await this.runtimeLoader.get();
    const tools = toAISDKTools(request.tools, runtime.tool);

    const response = await runtime.generateText({
      model: this.model,
      ...(request.systemPrompt?.trim() ? { system: request.systemPrompt.trim() } : {}),
      messages: toAISDKMessages(request),
      ...(Object.keys(tools).length > 0 ? { tools } : {}),
    });

    return parseAISDKResponse(response);
  }
}

function toAISDKMessages(request: ToolCallingModelRequest): Array<Record<string, unknown>> {
  const messages = mapConversationMessages(request, toAISDKMessage);

  for (const round of request.toolRounds ?? []) {
    messages.push({
      role: "assistant",
      content: round.toolCalls.map((call) => ({
        type: "tool-call",
        toolCallId: call.id,
        toolName: call.name,
        input: call.input,
      })),
    });

    messages.push({
      role: "tool",
      content: round.toolResults.map((result) => ({
        type: "tool-result",
        toolCallId: result.toolCallId,
        toolName: result.name,
        output: result.output,
      })),
    });
  }

  return messages;
}

function toAISDKMessage(entry: Record<string, unknown>): Record<string, unknown> | null {
  const role = normalizeConversationRole(entry.role);
  if (!role) {
    return null;
  }

  return {
    role,
    content: toDisplayText(entry.content),
  };
}

function toAISDKTools(
  schemas: Array<Record<string, unknown>>,
  toolFactory: AISDKToolFactory,
): Record<string, unknown> {
  const tools: Record<string, unknown> = {};

  for (const schema of schemas) {
    const functionRecordRaw = schema.function;
    if (!functionRecordRaw || typeof functionRecordRaw !== "object" || Array.isArray(functionRecordRaw)) {
      continue;
    }
    const functionRecord = functionRecordRaw as Record<string, unknown>;

    const name = typeof functionRecord.name === "string" ? functionRecord.name : null;
    if (!name) {
      continue;
    }

    const description = typeof functionRecord.description === "string"
      ? functionRecord.description
      : undefined;
    const parameters = functionRecord.parameters;

    tools[name] = toolFactory({
      ...(description ? { description } : {}),
      inputSchema: parameters && typeof parameters === "object" && !Array.isArray(parameters)
        ? parameters as Record<string, unknown>
        : { type: "object", properties: {}, required: [] },
    });
  }

  return tools;
}

function parseAISDKResponse(response: Record<string, unknown>): ToolCallingResponse {
  const text = typeof response.text === "string" ? response.text.trim() : "";
  const toolCalls = parseAISDKToolCalls(response.toolCalls);

  return {
    ...(text ? { text } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

function parseAISDKToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const toolCalls: ToolCall[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const toolCall = value as Record<string, unknown>;
    const id = typeof toolCall.toolCallId === "string" ? toolCall.toolCallId : null;
    const name = typeof toolCall.toolName === "string" ? toolCall.toolName : null;
    if (!id || !name) {
      continue;
    }

    const input = toolCall.input;
    const error = toolCall.error;
    const parseError = toolCall.invalid === true
      ? (error instanceof Error ? error.message : (typeof error === "string" ? error : "AI SDK returned an invalid tool call."))
      : undefined;

    toolCalls.push({
      id,
      name,
      input: input && typeof input === "object" && !Array.isArray(input)
        ? input as Record<string, unknown>
        : {},
      ...(parseError ? { inputParseError: parseError } : {}),
    });
  }

  return toolCalls;
}

async function loadAISDKRuntime(): Promise<AISDKRuntime> {
  const module = (await import("ai").catch((error: unknown) => {
    throw new UnsupportedFeatureError(
      `AISDKAdapter requires optional dependency "ai". Install it with "pnpm add ai". (${error instanceof Error ? error.message : String(error)})`,
    );
  })) as {
    generateText?: AISDKGenerateText;
    tool?: AISDKToolFactory;
  };

  if (!module.generateText || !module.tool) {
    throw new UnsupportedFeatureError(
      'AISDKAdapter requires optional dependency "ai". Install it with "pnpm add ai".',
    );
  }

  return {
    generateText: module.generateText,
    tool: module.tool,
  };
}
