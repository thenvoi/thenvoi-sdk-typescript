import type { ToolCall, ToolCallingModelRequest } from "./types";

/**
 * Returns tool calls from the request, synthesizing stubs from tool results
 * when only the deprecated `toolResults` field is provided without `toolCalls`.
 * Synthesized stubs use `input: {}` because the original arguments are not
 * available on ToolResult — callers should migrate to `toolRounds` instead.
 */
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

/**
 * Merge consecutive messages with the same role by concatenating their content
 * with newlines. Required by APIs (Anthropic, Gemini) that enforce alternating roles.
 */
export function mergeConsecutiveSameRole(
  messages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  if (messages.length <= 1) {
    return messages;
  }

  const merged: Array<Record<string, unknown>> = [];
  for (const msg of messages) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role && typeof prev.content === "string" && typeof msg.content === "string") {
      prev.content = `${prev.content}\n\n${msg.content}`;
    } else {
      merged.push({ ...msg });
    }
  }

  return merged;
}
