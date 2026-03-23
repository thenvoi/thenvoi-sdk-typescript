import type { HistoryConverter } from "../contracts/protocols";

import { parseToolCall, parseToolResult } from "./shared";

export type VercelAISDKMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
    role: "assistant";
    content: Array<
      | { type: "text"; text: string }
      | { type: "tool-call"; toolCallId: string; toolName: string; input: Record<string, unknown> }
    >;
  }
  | {
    role: "tool";
    content: Array<{
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: unknown;
    }>;
  };

export type VercelAISDKMessages = VercelAISDKMessage[];

type VercelAISDKToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
};

type VercelAISDKToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: unknown;
};

function flushPendingToolCalls(messages: VercelAISDKMessages, pendingToolCalls: VercelAISDKToolCallPart[]): void {
  if (pendingToolCalls.length === 0) {
    return;
  }

  messages.push({
    role: "assistant",
    content: [...pendingToolCalls],
  });
  pendingToolCalls.length = 0;
}

function flushPendingToolResults(
  messages: VercelAISDKMessages,
  pendingToolResults: VercelAISDKToolResultPart[],
): void {
  if (pendingToolResults.length === 0) {
    return;
  }

  messages.push({
    role: "tool",
    content: [...pendingToolResults],
  });
  pendingToolResults.length = 0;
}

export class VercelAISDKHistoryConverter implements HistoryConverter<VercelAISDKMessages> {
  private agentName: string;

  public constructor(agentName = "") {
    this.agentName = agentName;
  }

  public setAgentName(name: string): void {
    this.agentName = name;
  }

  public convert(raw: Array<Record<string, unknown>>): VercelAISDKMessages {
    const messages: VercelAISDKMessages = [];
    const pendingToolCalls: VercelAISDKToolCallPart[] = [];
    const pendingToolResults: VercelAISDKToolResultPart[] = [];

    for (const entry of raw) {
      const messageType = String(entry.message_type ?? "text");
      const content = String(entry.content ?? "");

      if (messageType === "tool_call") {
        flushPendingToolResults(messages, pendingToolResults);
        const parsed = parseToolCall(content);
        if (parsed) {
          pendingToolCalls.push({
            type: "tool-call",
            toolCallId: parsed.toolCallId,
            toolName: parsed.name,
            input: parsed.args,
          });
        }
        continue;
      }

      if (messageType === "tool_result") {
        flushPendingToolCalls(messages, pendingToolCalls);
        const parsed = parseToolResult(content);
        if (parsed) {
          pendingToolResults.push({
            type: "tool-result",
            toolCallId: parsed.toolCallId,
            toolName: parsed.name,
            output: parsed.isError ? { error: parsed.output } : parsed.output,
          });
        }
        continue;
      }

      if (messageType !== "text") {
        continue;
      }

      flushPendingToolCalls(messages, pendingToolCalls);
      flushPendingToolResults(messages, pendingToolResults);

      const role = String(entry.role ?? "user");
      const senderName = String(entry.sender_name ?? "");
      if (role === "assistant" && senderName === this.agentName) {
        continue;
      }

      messages.push({
        role: "user",
        content: senderName ? `[${senderName}]: ${content}` : content,
      });
    }

    flushPendingToolCalls(messages, pendingToolCalls);
    flushPendingToolResults(messages, pendingToolResults);
    return messages;
  }
}
