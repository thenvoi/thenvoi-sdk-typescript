import { SimpleAdapter } from "../../core/simpleAdapter";
import type { MessagingTools } from "../../contracts/protocols";
import type { Logger } from "../../core/logger";
import { NoopLogger } from "../../core/logger";
import type { HistoryProvider, PlatformMessage } from "../../runtime/types";
import { buildConversationPrompt } from "../shared/conversationPrompt";
import { findLatestTaskMetadata } from "../shared/history";
import { LazyAsyncValue } from "../shared/lazyAsyncValue";
import type {
  ApprovalMode,
  ModelReasoningEffort,
  SandboxMode,
  WebSearchMode,
} from "@openai/codex-sdk";

export type CodexApprovalPolicy = ApprovalMode;
export type CodexSandboxMode = SandboxMode;
export type CodexWebSearchMode = WebSearchMode;
const CODEX_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const satisfies readonly ModelReasoningEffort[];
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

interface CodexThreadItem {
  id?: string;
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface CodexRunResult {
  finalResponse?: string | null;
  items: CodexThreadItem[];
}

interface CodexThreadLike {
  id: string | null;
  run(input: string): Promise<CodexRunResult>;
}

interface CodexClientLike {
  startThread(options?: CodexThreadOptions): CodexThreadLike;
  resumeThread(id: string, options?: CodexThreadOptions): CodexThreadLike;
}

interface CodexThreadOptions {
  model?: string;
  sandboxMode?: CodexSandboxMode;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  modelReasoningEffort?: CodexReasoningEffort;
  networkAccessEnabled?: boolean;
  webSearchMode?: CodexWebSearchMode;
  approvalPolicy?: CodexApprovalPolicy;
}

export interface CodexAdapterConfig {
  model?: string;
  cwd?: string;
  approvalPolicy?: CodexApprovalPolicy;
  sandboxMode?: CodexSandboxMode;
  reasoningEffort?: CodexReasoningEffort;
  networkAccessEnabled?: boolean;
  webSearchMode?: CodexWebSearchMode;
  skipGitRepoCheck?: boolean;
  enableExecutionReporting?: boolean;
  emitThoughtEvents?: boolean;
  maxHistoryMessages?: number;
  enableLocalCommands?: boolean;
}

export interface CodexFactory {
  (): Promise<CodexClientLike>;
}

export class CodexAdapter extends SimpleAdapter<HistoryProvider, MessagingTools> {
  private readonly baseConfig: CodexAdapterConfig;
  private readonly roomConfigOverrides = new Map<string, Partial<CodexAdapterConfig>>();
  private readonly factoryOverride?: CodexFactory;
  private readonly logger: Logger;
  private readonly clientLoader: LazyAsyncValue<CodexClientLike>;
  private lastInitFailure = 0;
  private readonly roomThreads = new Map<string, CodexThreadLike>();
  private readonly roomThreadInitPromises = new Map<string, Promise<CodexThreadLike>>();

  public constructor(options?: { config?: CodexAdapterConfig; factory?: CodexFactory; logger?: Logger }) {
    super();
    this.baseConfig = {
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      maxHistoryMessages: 50,
      enableLocalCommands: true,
      ...options?.config,
    };
    this.factoryOverride = options?.factory;
    this.logger = options?.logger ?? new NoopLogger();
    this.clientLoader = new LazyAsyncValue({
      load: async () => {
        const client = await (this.factoryOverride ?? loadCodexFactory())();
        return client;
      },
      onRejected: (error) => {
        this.lastInitFailure = Date.now();
        this.logger.error("Codex client initialization failed", {
          error,
        });
      },
    });
  }

  private getConfig(roomId: string): CodexAdapterConfig {
    const overrides = this.roomConfigOverrides.get(roomId);
    if (!overrides) {
      return this.baseConfig;
    }
    return { ...this.baseConfig, ...overrides };
  }

  private async ensureClient(): Promise<CodexClientLike> {
    if (this.clientLoader.current) {
      return this.clientLoader.get();
    }

    const cooldownMs = 2_000;
    const elapsed = Date.now() - this.lastInitFailure;
    if (this.lastInitFailure > 0 && elapsed < cooldownMs) {
      throw new Error(
        `Codex client init failed recently (${elapsed}ms ago). Retrying after ${cooldownMs}ms cooldown.`,
      );
    }

    return this.clientLoader.get();
  }

  public async onMessage(
    message: PlatformMessage,
    tools: MessagingTools,
    history: HistoryProvider,
    participantsMessage: string | null,
    contactsMessage: string | null,
    context: { isSessionBootstrap: boolean; roomId: string },
  ): Promise<void> {
    await this.ensureClient();

    const config = this.getConfig(context.roomId);
    if (config.enableLocalCommands) {
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

    const thread = await this.getOrCreateThread(
      context.roomId,
      history,
      context.isSessionBootstrap,
      config,
    );
    const prompt = buildConversationPrompt({
      history,
      isSessionBootstrap: context.isSessionBootstrap,
      participantsMessage,
      contactsMessage,
      historyHeader: "[Conversation History]",
      currentMessage: `[${message.senderName ?? message.senderType}]: ${message.content}`,
      maxHistoryMessages: config.maxHistoryMessages ?? 50,
    });

    const result = await thread.run(prompt);

    if (config.enableExecutionReporting) {
      await this.reportItems(tools, result.items, context.roomId, this.threadId(thread), config);
    }

    const mention = [{ id: message.senderId, handle: message.senderName ?? message.senderType }];

    const final = result.finalResponse?.trim();
    if (final) {
      await tools.sendMessage(final, mention);
    }
  }

  public async onCleanup(roomId: string): Promise<void> {
    this.roomThreads.delete(roomId);
    this.roomThreadInitPromises.delete(roomId);
    this.roomConfigOverrides.delete(roomId);
  }

  private async getOrCreateThread(
    roomId: string,
    history: HistoryProvider,
    isSessionBootstrap: boolean,
    config: CodexAdapterConfig,
  ): Promise<CodexThreadLike> {
    const existing = this.roomThreads.get(roomId);
    if (existing) {
      return existing;
    }

    const initializing = this.roomThreadInitPromises.get(roomId);
    if (initializing) {
      return initializing;
    }

    const client = this.clientLoader.current;
    if (!client) {
      throw new Error("Codex client not initialized");
    }

    const initPromise = (async (): Promise<CodexThreadLike> => {
      const resumeThreadId = isSessionBootstrap
        ? extractThreadIdFromHistory(history.raw)
        : null;

      let thread: CodexThreadLike;
      if (resumeThreadId) {
        try {
          thread = client.resumeThread(resumeThreadId, this.threadOptions(config));
        } catch (error) {
          this.logger.warn("Codex thread resume failed; starting a new thread", {
            roomId,
            resumeThreadId,
            error,
          });
          thread = client.startThread(this.threadOptions(config));
        }
      } else {
        thread = client.startThread(this.threadOptions(config));
      }

      this.roomThreads.set(roomId, thread);
      return thread;
    })();

    this.roomThreadInitPromises.set(roomId, initPromise);
    try {
      return await initPromise;
    } finally {
      const pending = this.roomThreadInitPromises.get(roomId);
      if (pending === initPromise) {
        this.roomThreadInitPromises.delete(roomId);
      }
    }
  }

  private async reportItems(
    tools: MessagingTools,
    items: CodexThreadItem[],
    roomId: string,
    threadId: string | null,
    config: CodexAdapterConfig,
  ): Promise<void> {
    for (const item of items) {
      if (item.type === "reasoning" && config.emitThoughtEvents && typeof item.text === "string") {
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

  private threadOptions(config: CodexAdapterConfig): CodexThreadOptions {
    const options: CodexThreadOptions = {
      approvalPolicy: config.approvalPolicy,
      sandboxMode: config.sandboxMode,
      networkAccessEnabled: config.networkAccessEnabled,
      webSearchMode: config.webSearchMode,
      skipGitRepoCheck: config.skipGitRepoCheck,
    };

    if (config.model) {
      options.model = config.model;
    }

    if (config.cwd) {
      options.workingDirectory = config.cwd;
    }

    if (config.reasoningEffort) {
      options.modelReasoningEffort = config.reasoningEffort;
    }

    return options;
  }

  private threadId(thread: CodexThreadLike): string | null {
    return typeof thread.id === "string" && thread.id.length > 0
      ? thread.id
      : null;
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
    const existingThread = this.roomThreads.get(input.roomId);
    const mappedThreadId = (existingThread ? this.threadId(existingThread) : null)
      ?? extractThreadIdFromHistory(input.history.raw);

    if (input.command === "help") {
      await input.tools.sendMessage(
        "Codex commands: `/status`, `/model`, `/models`, `/model list`, `/models list`, `/model <id>`, `/reasoning [low|medium|high|xhigh]`, `/help`.",
        mention,
      );
      return true;
    }

    if (input.command === "status") {
      const roomConfig = this.getConfig(input.roomId);
      await input.tools.sendMessage(
        [
          "Codex status:",
          `- selected_model: ${roomConfig.model ?? "auto"}`,
          `- room_id: ${input.roomId}`,
          `- thread_id: ${mappedThreadId ?? "not mapped"}`,
          `- approval_policy: ${roomConfig.approvalPolicy ?? "never"}`,
          `- sandbox_mode: ${roomConfig.sandboxMode ?? "workspace-write"}`,
          `- reasoning_effort: ${roomConfig.reasoningEffort ?? "default"}`,
        ].join("\n"),
        mention,
      );
      return true;
    }

    if (input.command === "model" || input.command === "models") {
      const modelArg = input.args.trim();
      if (!modelArg) {
        const roomConfig = this.getConfig(input.roomId);
        await input.tools.sendMessage(
          `Current model: \`${roomConfig.model ?? "auto"}\`. Use \`/model list\` or \`/model <id>\`.`,
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

      const overrides = this.roomConfigOverrides.get(input.roomId) ?? {};
      overrides.model = modelArg;
      this.roomConfigOverrides.set(input.roomId, overrides);
      this.roomThreads.delete(input.roomId);
      await input.tools.sendMessage(
        `Model override set to \`${modelArg}\` for subsequent turns.`,
        mention,
      );
      return true;
    }

    if (input.command === "reasoning") {
      const effortArg = input.args.trim().toLowerCase();
      const validEfforts = [...CODEX_REASONING_EFFORTS];

      if (!effortArg) {
        const roomConfig = this.getConfig(input.roomId);
        await input.tools.sendMessage(
          `Current reasoning effort: \`${roomConfig.reasoningEffort ?? "default"}\`. Use \`/reasoning ${validEfforts.join("|")}\`.`,
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

      const overrides = this.roomConfigOverrides.get(input.roomId) ?? {};
      overrides.reasoningEffort = effortArg as CodexReasoningEffort;
      this.roomConfigOverrides.set(input.roomId, overrides);
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
