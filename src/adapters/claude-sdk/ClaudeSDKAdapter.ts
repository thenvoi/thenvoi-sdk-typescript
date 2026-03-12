import { SimpleAdapter } from "../../core/simpleAdapter";
import type { AdapterToolsProtocol } from "../../contracts/protocols";
import type { Logger } from "../../core/logger";
import { NoopLogger } from "../../core/logger";
import type { HistoryProvider, PlatformMessage } from "../../runtime/types";
import { renderSystemPrompt } from "../../runtime/prompts";
import { buildConversationPrompt } from "../shared/conversationPrompt";
import { findLatestTaskMetadata } from "../shared/history";
import {
  createThenvoiMcpBridge,
  type ThenvoiMcpBridge,
} from "./mcp";

export type ClaudePermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "dontAsk";

interface ClaudeAssistantTextBlock {
  type?: string;
  text?: string;
}

interface ClaudeAssistantMessage {
  content: ClaudeAssistantTextBlock[];
}

interface ClaudeSDKMessageLike {
  type: string;
  session_id?: string;
  subtype?: string;
  result?: unknown;
  summary?: string;
  message?: ClaudeAssistantMessage;
  [key: string]: unknown;
}

interface ClaudeQueryOptions {
  model?: string;
  permissionMode?: ClaudePermissionMode;
  systemPrompt?: string;
  allowDangerouslySkipPermissions?: boolean;
  maxThinkingTokens?: number;
  cwd?: string;
  resume?: string;
  mcpServers?: Record<string, unknown>;
  allowedTools?: string[];
}

export interface ClaudeSDKQueryParams {
  prompt: string;
  options?: ClaudeQueryOptions;
}

export type ClaudeSDKQuery = (params: ClaudeSDKQueryParams) => AsyncIterable<ClaudeSDKMessageLike>;

export interface ClaudeSDKAdapterOptions {
  model?: string;
  customSection?: string;
  includeBaseInstructions?: boolean;
  maxThinkingTokens?: number;
  permissionMode?: ClaudePermissionMode;
  enableExecutionReporting?: boolean;
  enableMemoryTools?: boolean;
  enableMcpTools?: boolean;
  cwd?: string;
  queryFn?: ClaudeSDKQuery;
  logger?: Logger;
}

const DEFAULT_MODEL = "claude-sonnet-4-6";

export class ClaudeSDKAdapter extends SimpleAdapter<HistoryProvider, AdapterToolsProtocol> {
  private readonly model: string;
  private readonly customSection?: string;
  private readonly includeBaseInstructions: boolean;
  private readonly maxThinkingTokens?: number;
  private readonly permissionMode: ClaudePermissionMode;
  private readonly enableExecutionReporting: boolean;
  private readonly enableMemoryTools: boolean;
  private readonly enableMcpTools: boolean;
  private readonly cwd?: string;
  private readonly queryFnOverride?: ClaudeSDKQuery;
  private readonly logger: Logger;
  private readonly sessionIds = new Map<string, string>();
  private readonly roomTools = new Map<string, AdapterToolsProtocol>();
  private mcpBridge: ThenvoiMcpBridge | null = null;
  private systemPrompt = "";

  public constructor(options?: ClaudeSDKAdapterOptions) {
    super();
    this.model = options?.model ?? DEFAULT_MODEL;
    this.customSection = options?.customSection;
    this.includeBaseInstructions = options?.includeBaseInstructions ?? true;
    this.maxThinkingTokens = options?.maxThinkingTokens;
    this.permissionMode = options?.permissionMode ?? "acceptEdits";
    this.enableExecutionReporting = options?.enableExecutionReporting ?? false;
    this.enableMemoryTools = options?.enableMemoryTools ?? false;
    this.enableMcpTools = options?.enableMcpTools ?? true;
    this.cwd = options?.cwd;
    this.queryFnOverride = options?.queryFn;
    this.logger = options?.logger ?? new NoopLogger();
  }

  public async onStarted(agentName: string, agentDescription: string): Promise<void> {
    await super.onStarted(agentName, agentDescription);
    this.systemPrompt = renderSystemPrompt({
      agentName,
      agentDescription,
      customSection: this.customSection,
      includeBaseInstructions: this.includeBaseInstructions,
    });

    if (this.enableMcpTools) {
      this.mcpBridge = createThenvoiMcpBridge({
        enableMemoryTools: this.enableMemoryTools,
        getToolsForRoom: (roomId) => this.roomTools.get(roomId),
      });
    }
  }

  public async onMessage(
    message: PlatformMessage,
    tools: AdapterToolsProtocol,
    history: HistoryProvider,
    participantsMessage: string | null,
    contactsMessage: string | null,
    context: { isSessionBootstrap: boolean; roomId: string },
  ): Promise<void> {
    const queryFn = this.queryFnOverride ?? (await loadClaudeQuery());

    const options: ClaudeQueryOptions = {
      model: this.model,
      permissionMode: this.permissionMode,
      systemPrompt: this.systemPrompt,
    };
    if (this.permissionMode === "bypassPermissions") {
      options.allowDangerouslySkipPermissions = true;
    }
    if (this.maxThinkingTokens !== undefined) {
      options.maxThinkingTokens = this.maxThinkingTokens;
    }
    if (this.cwd) {
      options.cwd = this.cwd;
    }
    const existingSession = this.sessionIds.get(context.roomId)
      ?? (context.isSessionBootstrap ? extractSessionIdFromHistory(history.raw) : null);
    if (existingSession) {
      options.resume = existingSession;
    }

    if (this.mcpBridge && this.enableMcpTools) {
      options.mcpServers = {
        thenvoi: this.mcpBridge.serverConfig,
      };
      options.allowedTools = this.mcpBridge.allowedTools;
      this.roomTools.set(context.roomId, tools);
    }

    const roomToolHint = this.enableMcpTools
      ? `\n\n[Tooling note]: For any mcp__thenvoi__* tool call, pass room_id="${context.roomId}".`
      : "";

    const query = queryFn({
      prompt: buildConversationPrompt({
        history,
        isSessionBootstrap: context.isSessionBootstrap,
        participantsMessage,
        contactsMessage,
        historyHeader: "[Previous conversation context]",
        currentMessage: message.content,
        maxHistoryMessages: 50,
      }) + roomToolHint,
      options,
    });

    let finalText = "";
    for await (const event of query) {
      const type = event.type;
      const sessionId = event.session_id;
      if (typeof sessionId === "string" && sessionId) {
        const previousSessionId = this.sessionIds.get(context.roomId) ?? null;
        this.sessionIds.set(context.roomId, sessionId);
        if (sessionId !== previousSessionId) {
          await this.reportSessionId(tools, context.roomId, sessionId);
        }
      }

      if (type === "assistant") {
        const text = extractAssistantText(event);
        if (text) {
          finalText = text;
        }
      }

      if (type === "result" && event.subtype === "success" && typeof event.result === "string") {
        finalText = event.result;
      }

      if (this.enableExecutionReporting && type === "tool_use_summary") {
        await tools.sendEvent(JSON.stringify(event), "tool_call");
      }
    }

    if (finalText.trim()) {
      await tools.sendMessage(finalText.trim(), [{ id: message.senderId, handle: message.senderName ?? message.senderType }]);
    }
  }

  public async onCleanup(roomId: string): Promise<void> {
    this.sessionIds.delete(roomId);
    this.roomTools.delete(roomId);
  }

  private async reportSessionId(
    tools: AdapterToolsProtocol,
    roomId: string,
    sessionId: string,
  ): Promise<void> {
    try {
      await tools.sendEvent("Claude SDK session", "task", {
        claude_session_id: sessionId,
      });
    } catch (error) {
      this.logger.warn("Claude SDK session marker event failed", {
        roomId,
        sessionId,
        error,
      });
    }
  }
}

async function loadClaudeQuery(): Promise<ClaudeSDKQuery> {
  const module = (await import("@anthropic-ai/claude-agent-sdk")) as {
    query?: ClaudeSDKQuery;
  };

  if (!module.query) {
    throw new Error("@anthropic-ai/claude-agent-sdk did not export query()");
  }

  return module.query;
}

function extractAssistantText(event: ClaudeSDKMessageLike): string {
  if (event.type !== "assistant") {
    return "";
  }

  const blocks = event.message?.content ?? [];
  return blocks
    .map((block: { type?: string; text?: string }) => (block.type === "text" ? block.text ?? "" : ""))
    .filter((text: string) => text.length > 0)
    .join("\n");
}

function extractSessionIdFromHistory(
  raw: Array<Record<string, unknown>>,
): string | null {
  const metadata = findLatestTaskMetadata(
    raw,
    (entry) => typeof entry.claude_session_id === "string" && entry.claude_session_id.length > 0,
  );
  const sessionId = metadata?.claude_session_id;
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
}
