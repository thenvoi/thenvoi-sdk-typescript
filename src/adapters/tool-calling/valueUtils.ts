import type { ToolCall, ToolCallingModelRequest } from "./types";

export function ensureToolCalls(request: ToolCallingModelRequest): ToolCall[] {
  if ((request.toolCalls?.length ?? 0) > 0) {
    return request.toolCalls as ToolCall[];
  }

  return (request.toolResults ?? []).map((result) => ({
    id: result.toolCallId,
    name: result.name,
    input: {},
  }));
}

export function normalizeConversationRole(
  value: unknown,
): "system" | "user" | "assistant" | null {
  if (value === "system" || value === "user" || value === "assistant") {
    return value;
  }

  return null;
}

export function mapConversationMessages(
  request: ToolCallingModelRequest,
  mapper: (entry: Record<string, unknown>) => Record<string, unknown> | null,
): Array<Record<string, unknown>> {
  return request.messages
    .map((entry) => mapper(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}
