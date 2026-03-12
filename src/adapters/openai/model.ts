import type {
  ToolCall,
  ToolCallingModel,
  ToolCallingModelRequest,
  ToolCallingResponse,
} from "../tool-calling";
import { toDisplayText, toWireString } from "../shared/coercion";
import { LazyAsyncValue } from "../shared/lazyAsyncValue";
import {
  resolveToolCalls,
  resolveToolRounds,
  mapConversationMessages,
  normalizeConversationRole,
} from "../tool-calling/valueUtils";

interface OpenAIChatCompletionResponseLike {
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: unknown;
    };
  }>;
}

interface OpenAIClientLike {
  chat: {
    completions: {
      create(params: Record<string, unknown>): Promise<OpenAIChatCompletionResponseLike>;
    };
  };
}

export type OpenAIClientFactory = (input: { apiKey?: string }) => Promise<OpenAIClientLike>;

export interface OpenAIToolCallingModelOptions {
  model: string;
  apiKey?: string;
  clientFactory?: OpenAIClientFactory;
}

export class OpenAIToolCallingModel implements ToolCallingModel {
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly clientFactory?: OpenAIClientFactory;
  private readonly clientLoader: LazyAsyncValue<OpenAIClientLike>;

  public constructor(options: OpenAIToolCallingModelOptions) {
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.clientFactory = options.clientFactory;
    this.clientLoader = new LazyAsyncValue({
      load: async () => {
        const factory = this.clientFactory ?? (await loadOpenAIClientFactory());
        return factory({ apiKey: this.apiKey });
      },
    });
  }

  public async complete(request: ToolCallingModelRequest): Promise<ToolCallingResponse> {
    const client = await this.getClient();

    const messages = toOpenAIMessages(request);
    const tools = request.tools;

    const response = await client.chat.completions.create({
      model: this.model,
      messages,
      tools,
      tool_choice: tools.length > 0 ? "auto" : undefined,
    });

    return parseOpenAIResponse(response);
  }

  private async getClient(): Promise<OpenAIClientLike> {
    return this.clientLoader.get();
  }
}

function toOpenAIMessages(request: ToolCallingModelRequest): Array<Record<string, unknown>> {
  const messages = mapConversationMessages(request, toBaseOpenAIMessage);
  const systemPrompt = request.systemPrompt?.trim();
  if (systemPrompt) {
    messages.unshift({
      role: "system",
      content: systemPrompt,
    });
  }

  const rounds = resolveToolRounds(request);
  if (rounds.length === 0) {
    return messages;
  }

  for (const round of rounds) {
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: round.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: serializeArguments(call.input),
        },
      })),
    });

    for (const result of round.toolResults) {
      messages.push({
        role: "tool",
        tool_call_id: result.toolCallId,
        name: result.name,
        content: toWireString(result.output),
      });
    }
  }

  return messages;
}

function toBaseOpenAIMessage(
  entry: Record<string, unknown>,
): Record<string, unknown> | null {
  const role = normalizeConversationRole(entry.role);
  if (!role) {
    return null;
  }

  return {
    role,
    content: toDisplayText(entry.content),
  };
}

function parseOpenAIResponse(
  response: OpenAIChatCompletionResponseLike,
): ToolCallingResponse {
  const message = response.choices?.[0]?.message ?? {};
  const toolCalls = parseToolCalls(message.tool_calls);
  const text = parseText(message.content);

  return {
    text: text || undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

function parseToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const parsed: ToolCall[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object") {
      continue;
    }

    const callRecord = value as Record<string, unknown>;
    const id = typeof callRecord.id === "string" ? callRecord.id : null;
    const fn = callRecord.function;
    if (!id || !fn || typeof fn !== "object") {
      continue;
    }

    const fnRecord = fn as Record<string, unknown>;
    const name = typeof fnRecord.name === "string" ? fnRecord.name : null;
    if (!name) {
      continue;
    }

    const { input, parseError } = parseArguments(fnRecord.arguments);
    parsed.push({
      id,
      name,
      input,
      ...(parseError ? { inputParseError: parseError } : {}),
    });
  }

  return parsed;
}

function parseArguments(value: unknown): { input: Record<string, unknown>; parseError?: string } {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { input: value as Record<string, unknown> };
  }

  if (typeof value !== "string" || value.trim() === "") {
    return { input: {} };
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { input: parsed as Record<string, unknown> };
    }
    return {
      input: {},
      parseError: "Tool-call arguments must parse to a JSON object.",
    };
  } catch {
    return {
      input: {},
      parseError: "Tool-call arguments are not valid JSON.",
    };
  }
}

function parseText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const chunks: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }

    const partRecord = part as Record<string, unknown>;
    if (typeof partRecord.text === "string") {
      chunks.push(partRecord.text);
    }
  }

  return chunks.join("\n").trim();
}

function serializeArguments(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input);
  } catch {
    return "{}";
  }
}

async function loadOpenAIClientFactory(): Promise<OpenAIClientFactory> {
  const module = (await import("openai")) as {
    default?: new (options?: { apiKey?: string }) => OpenAIClientLike;
    OpenAI?: new (options?: { apiKey?: string }) => OpenAIClientLike;
  };

  const OpenAIClientCtor = module.default ?? module.OpenAI;
  if (!OpenAIClientCtor) {
    throw new Error(
      'OpenAIAdapter requires optional dependency "openai". Install it with "pnpm add openai".',
    );
  }

  return async ({ apiKey }) => new OpenAIClientCtor({ apiKey });
}
