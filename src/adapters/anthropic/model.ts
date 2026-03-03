import type {
  ToolCall,
  ToolCallingModel,
  ToolCallingModelRequest,
  ToolCallingResponse,
  ToolResult,
} from "../tool-calling";
import {
  ensureToolCalls,
  mapConversationMessages,
  normalizeConversationRole,
  toDisplayText,
  toWireString,
} from "../tool-calling/valueUtils";

interface AnthropicMessageResponseLike {
  content?: unknown;
}

interface AnthropicClientLike {
  messages: {
    create(params: Record<string, unknown>): Promise<AnthropicMessageResponseLike>;
  };
}

export type AnthropicClientFactory = (input: { apiKey?: string }) => Promise<AnthropicClientLike>;

export interface AnthropicToolCallingModelOptions {
  model: string;
  apiKey?: string;
  maxTokens?: number;
  clientFactory?: AnthropicClientFactory;
}

export class AnthropicToolCallingModel implements ToolCallingModel {
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly maxTokens: number;
  private readonly clientFactory?: AnthropicClientFactory;
  private client: AnthropicClientLike | null = null;

  public constructor(options: AnthropicToolCallingModelOptions) {
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.maxTokens = options.maxTokens ?? 4096;
    this.clientFactory = options.clientFactory;
  }

  public async complete(request: ToolCallingModelRequest): Promise<ToolCallingResponse> {
    const client = await this.getClient();

    const response = await client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: request.systemPrompt,
      messages: toAnthropicMessages(request),
      tools: request.tools,
    });

    return parseAnthropicResponse(response);
  }

  private async getClient(): Promise<AnthropicClientLike> {
    if (this.client) {
      return this.client;
    }

    const factory = this.clientFactory ?? (await loadAnthropicClientFactory());
    this.client = await factory({ apiKey: this.apiKey });
    return this.client;
  }
}

function toAnthropicMessages(
  request: ToolCallingModelRequest,
): Array<Record<string, unknown>> {
  const messages = mapConversationMessages(request, toBaseAnthropicMessage);

  if ((request.toolResults?.length ?? 0) === 0) {
    return messages;
  }

  const toolCalls = ensureToolCalls(request);
  messages.push({
    role: "assistant",
    content: toolCalls.map((call) => ({
      type: "tool_use",
      id: call.id,
      name: call.name,
      input: call.input,
    })),
  });

  const toolResultBlocks = (request.toolResults ?? []).map((result) => ({
    type: "tool_result",
    tool_use_id: result.toolCallId,
    content: serializeToolOutput(result.output),
    is_error: isToolError(result),
  }));

  messages.push({
    role: "user",
    content: toolResultBlocks,
  });

  return messages;
}

function toBaseAnthropicMessage(
  entry: Record<string, unknown>,
): Record<string, unknown> | null {
  const role = normalizeConversationRole(entry.role);
  if (!role) {
    return null;
  }

  if (role === "system") {
    return {
      role: "user",
      content: `[System]: ${toDisplayText(entry.content)}`,
    };
  }

  return {
    role,
    content: toDisplayText(entry.content),
  };
}

function parseAnthropicResponse(
  response: AnthropicMessageResponseLike,
): ToolCallingResponse {
  const blocks = Array.isArray(response.content) ? response.content : [];
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const blockRecord = block as Record<string, unknown>;
    const type = blockRecord.type;

    if (type === "text" && typeof blockRecord.text === "string") {
      textParts.push(blockRecord.text);
      continue;
    }

    if (type !== "tool_use") {
      continue;
    }

    const id = typeof blockRecord.id === "string" ? blockRecord.id : null;
    const name = typeof blockRecord.name === "string" ? blockRecord.name : null;
    if (!id || !name) {
      continue;
    }

    const input = blockRecord.input;
    toolCalls.push({
      id,
      name,
      input: input && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {},
    });
  }

  const text = textParts.join("\n").trim();
  return {
    text: text || undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

function serializeToolOutput(output: unknown): string {
  return toWireString(output);
}

function isToolError(result: ToolResult): boolean {
  if (typeof result.output === "string") {
    return result.output.toLowerCase().startsWith("error");
  }

  return false;
}

async function loadAnthropicClientFactory(): Promise<AnthropicClientFactory> {
  const module = (await import("@anthropic-ai/sdk")) as {
    default?: new (options?: { apiKey?: string }) => AnthropicClientLike;
    Anthropic?: new (options?: { apiKey?: string }) => AnthropicClientLike;
  };

  const AnthropicClientCtor = module.default ?? module.Anthropic;
  if (!AnthropicClientCtor) {
    throw new Error(
      'AnthropicAdapter requires optional dependency "@anthropic-ai/sdk". Install it with "pnpm add @anthropic-ai/sdk".',
    );
  }

  return async ({ apiKey }) => new AnthropicClientCtor({ apiKey });
}
