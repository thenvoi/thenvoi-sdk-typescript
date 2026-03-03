import { SimpleAdapter } from "../../core/simpleAdapter";
import type { MessagingTools, ToolExecutor, ToolSchemaProvider } from "../../contracts/protocols";
import type { ToolModelMessage } from "../../contracts/dtos";
import type { HistoryProvider, PlatformMessage } from "../../runtime/types";
import { formatHistoryForLlm } from "../../runtime/formatters";
import type {
  ToolCall,
  ToolCallingModel,
  ToolCallingModelRequest,
  ToolCallingResponse,
  ToolResult,
} from "./types";

export interface ToolCallingAdapterOptions {
  model: ToolCallingModel;
  toolFormat: "openai" | "anthropic";
  systemPrompt?: string;
  includeMemoryTools?: boolean;
  maxToolRounds?: number;
  enableExecutionReporting?: boolean;
}

type ToolCallingTools = MessagingTools & ToolExecutor & ToolSchemaProvider;

export class ToolCallingAdapter extends SimpleAdapter<HistoryProvider, ToolCallingTools> {
  private readonly model: ToolCallingModel;
  private readonly toolFormat: "openai" | "anthropic";
  private readonly systemPrompt?: string;
  private readonly includeMemoryTools: boolean;
  private readonly maxToolRounds: number;
  private readonly enableExecutionReporting: boolean;

  public constructor(options: ToolCallingAdapterOptions) {
    super();
    this.model = options.model;
    this.toolFormat = options.toolFormat;
    this.systemPrompt = options.systemPrompt;
    this.includeMemoryTools = options.includeMemoryTools ?? false;
    this.maxToolRounds = options.maxToolRounds ?? 8;
    this.enableExecutionReporting = options.enableExecutionReporting ?? false;
  }

  public async onMessage(
    message: PlatformMessage,
    tools: ToolCallingTools,
    history: HistoryProvider,
    participantsMessage: string | null,
    contactsMessage: string | null,
    _context: { isSessionBootstrap: boolean; roomId: string },
  ): Promise<void> {
    const schemas = tools.getToolSchemas(this.toolFormat, {
      includeMemory: this.includeMemoryTools,
    });

    const messages = this.buildMessages(history, message, participantsMessage, contactsMessage);

    const allToolCalls: ToolCall[] = [];
    const allToolResults: ToolResult[] = [];

    let response = await this.model.complete({
      systemPrompt: this.systemPrompt,
      messages,
      tools: schemas,
    });

    let rounds = 0;
    while ((response.toolCalls?.length ?? 0) > 0) {
      rounds += 1;
      if (rounds > this.maxToolRounds) {
        await tools.sendEvent(
          `Stopped tool loop after ${this.maxToolRounds} rounds to prevent infinite recursion.`,
          "error",
        );
        return;
      }

      const roundToolCalls = response.toolCalls ?? [];
      allToolCalls.push(...roundToolCalls);

      const roundToolResults: ToolResult[] = [];
      for (const call of roundToolCalls) {
        if (this.enableExecutionReporting) {
          try {
            await tools.sendEvent(
              JSON.stringify({
                name: call.name,
                args: call.input,
                tool_call_id: call.id,
              }),
              "tool_call",
            );
          } catch {
            // Best effort event reporting; never break tool execution on event failures.
          }
        }

        const output = await tools.executeToolCall(call.name, call.input);
        const isError = isToolOutputError(output);
        roundToolResults.push({
          toolCallId: call.id,
          name: call.name,
          output,
          isError,
        });

        if (this.enableExecutionReporting) {
          try {
            await tools.sendEvent(
              JSON.stringify({
                name: call.name,
                output,
                tool_call_id: call.id,
              }),
              "tool_result",
            );
          } catch {
            // Best effort event reporting; never break tool execution on event failures.
          }
        }
      }

      allToolResults.push(...roundToolResults);

      response = await this.model.complete({
        systemPrompt: this.systemPrompt,
        messages,
        tools: schemas,
        toolCalls: allToolCalls,
        toolResults: allToolResults,
      });
    }

    const text = response.text?.trim();
    if (text) {
      await tools.sendMessage(text);
    }
  }

  private buildMessages(
    history: HistoryProvider,
    message: PlatformMessage,
    participantsMessage: string | null,
    contactsMessage: string | null,
  ): ToolModelMessage[] {
    const base = formatHistoryForLlm(history.raw) as ToolModelMessage[];
    base.push({
      role: message.senderType === "Agent" ? "assistant" : "user",
      content: message.content,
      sender_name: message.senderName,
      sender_type: message.senderType,
      message_type: message.messageType,
      metadata: message.metadata,
    });

    if (participantsMessage) {
      base.push({ role: "system", content: participantsMessage });
    }

    if (contactsMessage) {
      base.push({ role: "system", content: contactsMessage });
    }

    return base;
  }
}

function isToolOutputError(output: unknown): boolean {
  if (typeof output === "string") {
    return output.toLowerCase().startsWith("error");
  }

  if (output && typeof output === "object" && "ok" in output) {
    return (output as Record<string, unknown>).ok === false;
  }

  return false;
}

export function runSingleToolRound(
  model: ToolCallingModel,
  request: ToolCallingModelRequest,
): Promise<ToolCallingResponse> {
  return model.complete(request);
}
