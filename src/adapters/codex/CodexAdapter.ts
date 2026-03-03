import { SimpleAdapter } from "../../core/simpleAdapter";
import type { MessagingTools } from "../../contracts/protocols";
import type { HistoryProvider, PlatformMessage } from "../../runtime/types";
import { buildConversationPrompt } from "../shared/conversationPrompt";
import { findLatestTaskMetadata } from "../shared/history";
import type {
  ApprovalMode,
  Codex as CodexClient,
  ModelReasoningEffort,
  SandboxMode,
  Thread as CodexThread,
  ThreadItem,
  ThreadOptions,
  WebSearchMode,
} from "@openai/codex-sdk";

export type CodexApprovalPolicy = ApprovalMode;
export type CodexSandboxMode = SandboxMode;
export type CodexReasoningEffort = ModelReasoningEffort;

export interface CodexAdapterConfig {
  model?: string;
  cwd?: string;
  approvalPolicy?: CodexApprovalPolicy;
  sandboxMode?: CodexSandboxMode;
  reasoningEffort?: CodexReasoningEffort;
  networkAccessEnabled?: boolean;
  webSearchMode?: WebSearchMode;
  skipGitRepoCheck?: boolean;
  enableExecutionReporting?: boolean;
  emitThoughtEvents?: boolean;
  maxHistoryMessages?: number;
  enableLocalCommands?: boolean;
}

type CodexThreadLike = Pick<CodexThread, "id" | "run">;

type CodexClientLike = Pick<CodexClient, "startThread" | "resumeThread">;

export interface CodexFactory {
  (): Promise<CodexClientLike>;
}

export class CodexAdapter extends SimpleAdapter<HistoryProvider, MessagingTools> {
  private readonly config: CodexAdapterConfig;
  private readonly factoryOverride?: CodexFactory;
  private codexClient: CodexClientLike | null = null;
  private readonly roomThreads = new Map<string, CodexThreadLike>();

  public constructor(options?: { config?: CodexAdapterConfig; factory?: CodexFactory }) {
    super();
    this.config = {
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      maxHistoryMessages: 50,
      enableLocalCommands: true,
      ...options?.config,
    };
    this.factoryOverride = options?.factory;
  }

  public async onMessage(
    message: PlatformMessage,
    tools: MessagingTools,
    history: HistoryProvider,
    participantsMessage: string | null,
    contactsMessage: string | null,
    context: { isSessionBootstrap: boolean; roomId: string },
  ): Promise<void> {
    if (!this.codexClient) {
      this.codexClient = await (this.factoryOverride ?? loadCodexFactory())();
    }

    if (this.config.enableLocalCommands) {
      const command = extractLocalCommand(message.content);
      if (command) {
        const handled = await this.handleLocalCommand({
          tools,
          message,
          history,
          roomId: context.roomId,
          command: command.command,
          args: command.args,
        });
        if (handled) {
          return;
        }
      }
    }

    const thread = this.getOrCreateThread(
      context.roomId,
      history,
      context.isSessionBootstrap,
    );
    const prompt = buildConversationPrompt({
      history,
      isSessionBootstrap: context.isSessionBootstrap,
      participantsMessage,
      contactsMessage,
      historyHeader: "[Conversation History]",
      currentMessage: `[${message.senderName ?? message.senderType}]: ${message.content}`,
      maxHistoryMessages: this.config.maxHistoryMessages ?? 50,
    });

    const result = await thread.run(prompt);

    if (this.config.enableExecutionReporting) {
      await this.reportItems(tools, result.items, context.roomId, this.threadId(thread));
    }

    const final = result.finalResponse?.trim();
    if (final) {
      await tools.sendMessage(final);
    }
  }

  public async onCleanup(roomId: string): Promise<void> {
    this.roomThreads.delete(roomId);
  }

  private getOrCreateThread(
    roomId: string,
    history: HistoryProvider,
    isSessionBootstrap: boolean,
  ): CodexThreadLike {
    const existing = this.roomThreads.get(roomId);
    if (existing) {
      return existing;
    }

    if (!this.codexClient) {
      throw new Error("Codex client not initialized");
    }

    const resumeThreadId = isSessionBootstrap
      ? extractThreadIdFromHistory(history.raw)
      : null;

    let thread: CodexThreadLike;
    if (resumeThreadId) {
      try {
        thread = this.codexClient.resumeThread(resumeThreadId, this.threadOptions());
      } catch {
        thread = this.codexClient.startThread(this.threadOptions());
      }
    } else {
      thread = this.codexClient.startThread(this.threadOptions());
    }

    this.roomThreads.set(roomId, thread);
    return thread;
  }

  private async reportItems(
    tools: MessagingTools,
    items: ThreadItem[],
    roomId: string,
    threadId: string | null,
  ): Promise<void> {
    for (const item of items) {
      if (item.type === "reasoning" && this.config.emitThoughtEvents) {
        await tools.sendEvent(item.text, "thought");
        continue;
      }

      if (item.type === "command_execution" || item.type === "file_change" || item.type === "mcp_tool_call") {
        await tools.sendEvent(JSON.stringify(item), "task", {
          codex_room_id: roomId,
          codex_thread_id: threadId,
        });
      }
    }
  }

  private threadOptions(): ThreadOptions {
    const options: ThreadOptions = {
      approvalPolicy: this.config.approvalPolicy,
      sandboxMode: this.config.sandboxMode,
      networkAccessEnabled: this.config.networkAccessEnabled,
      webSearchMode: this.config.webSearchMode,
      skipGitRepoCheck: this.config.skipGitRepoCheck,
    };

    if (this.config.model) {
      options.model = this.config.model;
    }

    if (this.config.cwd) {
      options.workingDirectory = this.config.cwd;
    }

    if (this.config.reasoningEffort) {
      options.modelReasoningEffort = this.config.reasoningEffort;
    }

    return options;
  }

  private threadId(thread: CodexThreadLike): string | null {
    return typeof thread.id === "string" && thread.id.length > 0
      ? thread.id
      : null;
  }

  private threadIdOrNull(thread: CodexThreadLike | undefined): string | null {
    if (!thread) {
      return null;
    }

    return this.threadId(thread);
  }

  private async handleLocalCommand(input: {
    tools: MessagingTools;
    message: PlatformMessage;
    history: HistoryProvider;
    roomId: string;
    command: string;
    args: string;
  }): Promise<boolean> {
    const mention = [{ id: input.message.senderId, handle: input.message.senderName ?? undefined }];
    const mappedThreadId = this.threadIdOrNull(this.roomThreads.get(input.roomId))
      ?? extractThreadIdFromHistory(input.history.raw);

    if (input.command === "help") {
      await input.tools.sendMessage(
        "Codex commands: `/status`, `/model`, `/models`, `/model list`, `/models list`, `/model <id>`, `/reasoning [minimal|low|medium|high|xhigh]`, `/help`.",
        mention,
      );
      return true;
    }

    if (input.command === "status") {
      await input.tools.sendMessage(
        [
          "Codex status:",
          `- selected_model: ${this.config.model ?? "auto"}`,
          `- room_id: ${input.roomId}`,
          `- thread_id: ${mappedThreadId ?? "not mapped"}`,
          `- approval_policy: ${this.config.approvalPolicy ?? "never"}`,
          `- sandbox_mode: ${this.config.sandboxMode ?? "workspace-write"}`,
          `- reasoning_effort: ${this.config.reasoningEffort ?? "default"}`,
        ].join("\n"),
        mention,
      );
      return true;
    }

    if (input.command === "model" || input.command === "models") {
      const modelArg = input.args.trim();
      if (!modelArg) {
        await input.tools.sendMessage(
          `Current model: \`${this.config.model ?? "auto"}\`. Use \`/model list\` or \`/model <id>\`.`,
          mention,
        );
        return true;
      }

      if (modelArg === "list" || modelArg === "ls") {
        await input.tools.sendMessage(
          "Model listing is not exposed by @openai/codex-sdk. Set one directly with `/model <id>`.",
          mention,
        );
        return true;
      }

      this.config.model = modelArg;
      this.roomThreads.delete(input.roomId);
      await input.tools.sendMessage(
        `Model override set to \`${modelArg}\` for subsequent turns.`,
        mention,
      );
      return true;
    }

    if (input.command === "reasoning") {
      const effortArg = input.args.trim().toLowerCase();
      const validEfforts: CodexReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh"];

      if (!effortArg) {
        await input.tools.sendMessage(
          `Current reasoning effort: \`${this.config.reasoningEffort ?? "default"}\`. Use \`/reasoning ${validEfforts.join("|")}\`.`,
          mention,
        );
        return true;
      }

      if (!validEfforts.includes(effortArg as CodexReasoningEffort)) {
        await input.tools.sendMessage(
          `Invalid reasoning effort \`${effortArg}\`. Valid values: ${validEfforts.join(", ")}.`,
          mention,
        );
        return true;
      }

      this.config.reasoningEffort = effortArg as CodexReasoningEffort;
      this.roomThreads.delete(input.roomId);
      await input.tools.sendMessage(
        `Reasoning effort set to \`${effortArg}\` for subsequent turns.`,
        mention,
      );
      return true;
    }

    return false;
  }
}

function extractLocalCommand(
  content: string,
): { command: string; args: string } | null {
  const tokens = content.trim().split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return null;
  }

  const commands = new Set([
    "help",
    "status",
    "model",
    "models",
    "reasoning",
  ]);

  const searchLimit = Math.min(tokens.length, 5);
  for (let index = 0; index < searchLimit; index += 1) {
    const token = tokens[index];
    if (!token?.startsWith("/") || token.length === 1) {
      continue;
    }

    const command = token.slice(1).toLowerCase();
    if (!commands.has(command)) {
      continue;
    }

    return {
      command,
      args: tokens.slice(index + 1).join(" ").trim(),
    };
  }

  return null;
}

function extractThreadIdFromHistory(
  raw: Array<Record<string, unknown>>,
): string | null {
  const metadata = findLatestTaskMetadata(
    raw,
    (entry) => typeof entry.codex_thread_id === "string" && entry.codex_thread_id.length > 0,
  );
  const threadId = metadata?.codex_thread_id;
  return typeof threadId === "string" && threadId.length > 0 ? threadId : null;
}

function loadCodexFactory(): CodexFactory {
  return async () => {
    const module = (await import("@openai/codex-sdk")) as {
      Codex?: new (options?: Record<string, unknown>) => CodexClientLike;
    };

    if (!module.Codex) {
      throw new Error("@openai/codex-sdk did not export Codex");
    }

    const codex = new module.Codex({});
    return codex;
  };
}
