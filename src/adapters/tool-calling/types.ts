import type { MetadataMap, ToolModelMessage, ToolModelSchema } from "../../contracts/dtos";

export interface ToolCall {
  id: string;
  name: string;
  input: MetadataMap;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  output: unknown;
  isError?: boolean;
}

export interface ToolCallingResponse {
  text?: string;
  toolCalls?: ToolCall[];
}

export interface ToolRound {
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
}

/**
 * Request payload sent to a {@link ToolCallingModel}.
 *
 * Model implementations should prefer `toolRounds` when present.
 * Fall back to the flat `toolCalls`/`toolResults` fields only when
 * `toolRounds` is undefined or empty (backwards compatibility).
 */
export interface ToolCallingModelRequest {
  systemPrompt?: string;
  messages: ToolModelMessage[];
  tools: ToolModelSchema[];
  /** @deprecated Use toolRounds instead for multi-round accuracy. */
  toolCalls?: ToolCall[];
  /** @deprecated Use toolRounds instead for multi-round accuracy. */
  toolResults?: ToolResult[];
  toolRounds?: ToolRound[];
}

export interface ToolCallingModel {
  complete(request: ToolCallingModelRequest): Promise<ToolCallingResponse>;
}
