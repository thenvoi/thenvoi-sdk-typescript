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

export interface ToolCallingModelRequest {
  systemPrompt?: string;
  messages: ToolModelMessage[];
  tools: ToolModelSchema[];
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ToolCallingModel {
  complete(request: ToolCallingModelRequest): Promise<ToolCallingResponse>;
}
