import { SimpleAdapter } from "../../core/simpleAdapter";
import type { AdapterToolsProtocol } from "../../contracts/protocols";
import type { Logger } from "../../core/logger";
import { NoopLogger } from "../../core/logger";
import { UnsupportedFeatureError } from "../../core/errors";
import type { PlatformMessage } from "../../runtime/types";
import { renderSystemPrompt } from "../../runtime/prompts";
import { asErrorMessage, toWireString } from "../shared/coercion";
import { LazyAsyncValue } from "../shared/lazyAsyncValue";
import {
  LettaHistoryConverter,
  type LettaMessage,
  type LettaMessages,
} from "./types";

// ---------------------------------------------------------------------------
// Minimal Letta client surface
// ---------------------------------------------------------------------------

export interface LettaResponseMessage {
  id?: string;
  date?: string;
  message_type: string;
  content?: string | Array<{ text: string }>;
  reasoning?: string;
  tool_call?: {
    name: string;
    arguments: string;
    tool_call_id: string;
  };
  tool_return?: string;
  status?: string;
  tool_call_id?: string;
}

export interface LettaResponse {
  messages: LettaResponseMessage[];
  stop_reason: { stop_reason: string };
  usage?: Record<string, unknown>;
}

export interface LettaAgentCreateParams {
  name?: string;
  model?: string;
  embedding?: string;
  system?: string;
  memory_blocks?: Array<{ label: string; value: string }>;
  tools?: string[];
  include_base_tools?: boolean;
  context_window_limit?: number;
}

export interface LettaMessageCreateParams {
  messages?: Array<{ role: string; content: string; tool_call_id?: string }>;
  input?: string;
  client_tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  max_steps?: number;
}

export interface LettaClientLike {
  agents: {
    create(params: LettaAgentCreateParams): Promise<{ id: string }>;
    delete(agentId: string): Promise<void>;
    messages: {
      create(
        agentId: string,
        params: LettaMessageCreateParams,
      ): Promise<LettaResponse>;
    };
  };
}

export type LettaClientFactory = () => Promise<LettaClientLike>;

// ---------------------------------------------------------------------------
// Client tool schema conversion
// ---------------------------------------------------------------------------

interface LettaClientTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

function toClientTools(
  toolSchemas: Array<Record<string, unknown>>,
): LettaClientTool[] {
  const result: LettaClientTool[] = [];

  for (const schema of toolSchemas) {
    if (schema.type !== "function") {
      continue;
    }

    const fn = schema.function as
      | {
          name?: string;
          description?: string;
          parameters?: Record<string, unknown>;
        }
      | undefined;

    if (!fn?.name) {
      continue;
    }

    result.push({
      name: fn.name,
      description: fn.description ?? "",
      parameters: fn.parameters ?? { type: "object", properties: {} },
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Response parsing helpers
// ---------------------------------------------------------------------------

function extractAssistantText(messages: LettaResponseMessage[]): string | null {
  for (const msg of messages) {
    if (msg.message_type !== "assistant_message") {
      continue;
    }

    if (typeof msg.content === "string" && msg.content.trim().length > 0) {
      return msg.content.trim();
    }

    if (Array.isArray(msg.content)) {
      const text = msg.content
        .filter(
          (c): c is { text: string } =>
            typeof c === "object" && c !== null && "text" in c,
        )
        .map((c) => c.text)
        .join("");
      if (text.trim().length > 0) {
        return text.trim();
      }
    }
  }

  return null;
}

function extractApprovalRequests(
  messages: LettaResponseMessage[],
): LettaResponseMessage[] {
  return messages.filter(
    (msg) =>
      msg.message_type === "approval_request_message" && msg.tool_call != null,
  );
}

function extractReasoningMessages(
  messages: LettaResponseMessage[],
): string[] {
  return messages
    .filter(
      (msg) =>
        msg.message_type === "reasoning_message" &&
        typeof msg.reasoning === "string" &&
        msg.reasoning.trim().length > 0,
    )
    .map((msg) => msg.reasoning as string);
}

// ---------------------------------------------------------------------------
// Adapter options
// ---------------------------------------------------------------------------

export interface LettaAdapterOptions {
  model?: string;
  lettaApiKey?: string;
  lettaBaseUrl?: string;
  lettaAgentId?: string;
  embedding?: string;
  memoryBlocks?: Array<{ label: string; value: string }>;
  serverTools?: string[];
  includeBaseTools?: boolean;
  contextWindowLimit?: number;
  maxToolRounds?: number;
  responseTimeoutSeconds?: number;
  systemPrompt?: string;
  customSection?: string;
  includeBaseInstructions?: boolean;
  maxHistoryMessages?: number;
  emitReasoningEvents?: boolean;
  historyConverter?: LettaHistoryConverter;
  clientFactory?: LettaClientFactory;
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = "openai/gpt-4o";
const DEFAULT_MAX_TOOL_ROUNDS = 8;
const DEFAULT_RESPONSE_TIMEOUT_SECONDS = 120;
const DEFAULT_MAX_HISTORY_MESSAGES = 100;

export class LettaAdapter extends SimpleAdapter<
  LettaMessages,
  AdapterToolsProtocol
> {
  private readonly model: string;
  private readonly lettaApiKey?: string;
  private readonly lettaBaseUrl?: string;
  private readonly sharedLettaAgentId?: string;
  private readonly embedding?: string;
  private readonly memoryBlocks: Array<{ label: string; value: string }>;
  private readonly serverTools: string[];
  private readonly includeBaseTools: boolean;
  private readonly contextWindowLimit?: number;
  private readonly maxToolRounds: number;
  private readonly responseTimeoutSeconds: number;
  private readonly systemPromptOverride?: string;
  private readonly customSection?: string;
  private readonly includeBaseInstructions: boolean;
  private readonly maxHistoryMessages: number;
  private readonly emitReasoningEvents: boolean;
  private readonly clientFactory?: LettaClientFactory;
  private readonly logger: Logger;

  private readonly clientLoader: LazyAsyncValue<LettaClientLike>;
  private lastInitFailure = 0;
  private systemPrompt = "";

  private readonly roomAgents = new Map<string, string>();
  private readonly bootstrappedRooms = new Set<string>();
  private readonly roomAgentInitPromises = new Map<string, Promise<string>>();
  private readonly roomBootstrapInitPromises = new Map<
    string,
    Promise<void>
  >();

  public constructor(options: LettaAdapterOptions = {}) {
    super({
      historyConverter:
        options.historyConverter ?? new LettaHistoryConverter(),
    });

    this.model = options.model ?? DEFAULT_MODEL;
    this.lettaApiKey = options.lettaApiKey;
    this.lettaBaseUrl = options.lettaBaseUrl;
    this.sharedLettaAgentId = options.lettaAgentId;
    this.embedding = options.embedding;
    this.memoryBlocks = options.memoryBlocks ?? [];
    this.serverTools = options.serverTools ?? [];
    this.includeBaseTools = options.includeBaseTools ?? false;
    this.contextWindowLimit = options.contextWindowLimit;
    this.maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    this.responseTimeoutSeconds =
      options.responseTimeoutSeconds ?? DEFAULT_RESPONSE_TIMEOUT_SECONDS;
    this.systemPromptOverride = options.systemPrompt;
    this.customSection = options.customSection;
    this.includeBaseInstructions = options.includeBaseInstructions ?? true;
    this.maxHistoryMessages =
      options.maxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES;
    this.emitReasoningEvents = options.emitReasoningEvents ?? true;
    this.clientFactory = options.clientFactory;
    this.logger = options.logger ?? new NoopLogger();
    this.clientLoader = new LazyAsyncValue({
      load: async () => this.createClient(),
      onRejected: (error) => {
        this.lastInitFailure = Date.now();
        this.logger.error("Letta client initialization failed", { error });
      },
    });
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  public async onStarted(
    agentName: string,
    agentDescription: string,
  ): Promise<void> {
    await super.onStarted(agentName, agentDescription);

    this.systemPrompt =
      this.systemPromptOverride ??
      renderSystemPrompt({
        agentName,
        agentDescription,
        customSection: this.customSection,
        includeBaseInstructions: this.includeBaseInstructions,
      });
  }

  public async onMessage(
    message: PlatformMessage,
    tools: AdapterToolsProtocol,
    history: LettaMessages,
    participantsMessage: string | null,
    contactsMessage: string | null,
    context: { isSessionBootstrap: boolean; roomId: string },
  ): Promise<void> {
    try {
      const client = await this.ensureClient();
      const agentId = await this.getOrCreateAgent(client, context.roomId);

      if (context.isSessionBootstrap) {
        await this.ensureBootstrapHistory(
          client,
          agentId,
          context.roomId,
          history,
        );
      }

      const userContent = buildUserMessage({
        content: message.content,
        participantsMessage,
        contactsMessage,
      });

      const clientTools = toClientTools(tools.getOpenAIToolSchemas());
      const assistantText = await this.executeWithToolLoop(
        client,
        agentId,
        userContent,
        clientTools,
        tools,
      );

      if (!assistantText) {
        await tools.sendEvent(
          "Letta did not return a response.",
          "error",
          { letta_agent_id: agentId },
        );
        return;
      }

      await tools.sendMessage(assistantText, [{ id: message.senderId }]);
    } catch (error) {
      const errorMessage = asErrorMessage(error);
      this.logger.error("Letta adapter request failed", {
        roomId: context.roomId,
        error,
      });

      try {
        await tools.sendEvent(
          `Letta adapter error: ${errorMessage}`,
          "error",
          { letta_error: errorMessage },
        );
      } catch (eventError) {
        this.logger.warn("Letta adapter failed to emit error event", {
          roomId: context.roomId,
          error: eventError,
        });
      }

      throw error instanceof Error ? error : new Error(errorMessage);
    }
  }

  public async onCleanup(roomId: string): Promise<void> {
    const pendingAgent = this.roomAgentInitPromises.get(roomId);
    const pendingBootstrap = this.roomBootstrapInitPromises.get(roomId);
    await Promise.allSettled(
      [pendingAgent, pendingBootstrap].filter(Boolean),
    );

    this.roomAgents.delete(roomId);
    this.bootstrappedRooms.delete(roomId);
    this.roomAgentInitPromises.delete(roomId);
    this.roomBootstrapInitPromises.delete(roomId);
  }

  // -----------------------------------------------------------------------
  // Agent-per-room management
  // -----------------------------------------------------------------------

  private async getOrCreateAgent(
    client: LettaClientLike,
    roomId: string,
  ): Promise<string> {
    if (this.sharedLettaAgentId) {
      return this.sharedLettaAgentId;
    }

    const existing = this.roomAgents.get(roomId);
    if (existing) {
      return existing;
    }

    const initializing = this.roomAgentInitPromises.get(roomId);
    if (initializing) {
      return initializing;
    }

    const initPromise = (async (): Promise<string> => {
      const agent = await client.agents.create({
        name: `thenvoi-room-${roomId.slice(0, 8)}`,
        model: this.model,
        ...(this.embedding ? { embedding: this.embedding } : {}),
        system: this.systemPrompt || undefined,
        memory_blocks:
          this.memoryBlocks.length > 0 ? this.memoryBlocks : undefined,
        tools: this.serverTools.length > 0 ? this.serverTools : undefined,
        include_base_tools: this.includeBaseTools,
        ...(this.contextWindowLimit
          ? { context_window_limit: this.contextWindowLimit }
          : {}),
      });

      this.roomAgents.set(roomId, agent.id);
      return agent.id;
    })();

    this.roomAgentInitPromises.set(roomId, initPromise);
    try {
      return await initPromise;
    } finally {
      const pending = this.roomAgentInitPromises.get(roomId);
      if (pending === initPromise) {
        this.roomAgentInitPromises.delete(roomId);
      }
    }
  }

  // -----------------------------------------------------------------------
  // History bootstrap
  // -----------------------------------------------------------------------

  private async ensureBootstrapHistory(
    client: LettaClientLike,
    agentId: string,
    roomId: string,
    history: LettaMessages,
  ): Promise<void> {
    if (this.sharedLettaAgentId) {
      return;
    }

    if (this.bootstrappedRooms.has(roomId)) {
      return;
    }

    const initializing = this.roomBootstrapInitPromises.get(roomId);
    if (initializing) {
      await initializing;
      return;
    }

    const initPromise = (async (): Promise<void> => {
      if (this.bootstrappedRooms.has(roomId)) {
        return;
      }
      await this.injectHistory(client, agentId, history);
      this.bootstrappedRooms.add(roomId);
    })();

    this.roomBootstrapInitPromises.set(roomId, initPromise);
    try {
      await initPromise;
    } finally {
      const pending = this.roomBootstrapInitPromises.get(roomId);
      if (pending === initPromise) {
        this.roomBootstrapInitPromises.delete(roomId);
      }
    }
  }

  private async injectHistory(
    client: LettaClientLike,
    agentId: string,
    history: LettaMessages,
  ): Promise<void> {
    if (history.length === 0) {
      return;
    }

    const completeHistory = selectCompleteExchanges(history).slice(
      -this.maxHistoryMessages,
    );

    if (completeHistory.length === 0) {
      return;
    }

    const lines: string[] = [
      "[System]: The following is conversation history from a previous session. Use it for context.",
    ];

    for (const item of completeHistory) {
      if (item.role === "user") {
        lines.push(item.content);
      } else {
        const name = item.sender || this.agentName || "Assistant";
        lines.push(`[${name}]: ${item.content}`);
      }
    }

    try {
      await client.agents.messages.create(agentId, {
        messages: [{ role: "user", content: lines.join("\n\n") }],
      });
    } catch (error) {
      this.logger.warn("Letta history injection failed", {
        agentId,
        error,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Tool-calling loop
  // -----------------------------------------------------------------------

  private async executeWithToolLoop(
    client: LettaClientLike,
    agentId: string,
    content: string,
    clientTools: LettaClientTool[],
    tools: AdapterToolsProtocol,
  ): Promise<string | null> {
    const deadline = Date.now() + this.responseTimeoutSeconds * 1_000;

    let response = await client.agents.messages.create(agentId, {
      messages: [{ role: "user", content }],
      client_tools: clientTools.length > 0 ? clientTools : undefined,
    });

    let rounds = 0;
    let assistantText: string | null = null;

    while (rounds < this.maxToolRounds && Date.now() < deadline) {
      await this.emitReasoning(response, tools);
      assistantText = extractAssistantText(response.messages) ?? assistantText;

      const approvals = extractApprovalRequests(response.messages);
      if (
        approvals.length === 0 ||
        response.stop_reason.stop_reason !== "requires_approval"
      ) {
        break;
      }

      const toolResults: Array<{
        role: string;
        tool_call_id: string;
        content: string;
      }> = [];

      for (const approval of approvals) {
        const { name, arguments: argsJson, tool_call_id } =
          approval.tool_call!;
        try {
          const args = JSON.parse(argsJson) as Record<string, unknown>;
          const result = await tools.executeToolCall(name, args);
          toolResults.push({
            role: "tool",
            tool_call_id,
            content: toWireString(result),
          });
        } catch (error) {
          toolResults.push({
            role: "tool",
            tool_call_id,
            content: toWireString(asErrorMessage(error)),
          });
        }
      }

      response = await client.agents.messages.create(agentId, {
        messages: toolResults,
        client_tools: clientTools.length > 0 ? clientTools : undefined,
      });

      rounds += 1;
    }

    // Pick up any final assistant text from the last response.
    assistantText = extractAssistantText(response.messages) ?? assistantText;
    await this.emitReasoning(response, tools);

    return assistantText;
  }

  // -----------------------------------------------------------------------
  // Reasoning event emission
  // -----------------------------------------------------------------------

  private async emitReasoning(
    response: LettaResponse,
    tools: AdapterToolsProtocol,
  ): Promise<void> {
    if (!this.emitReasoningEvents) {
      return;
    }

    const reasonings = extractReasoningMessages(response.messages);
    for (const reasoning of reasonings) {
      try {
        await tools.sendEvent(reasoning, "thought");
      } catch (error) {
        this.logger.debug("Failed to emit Letta reasoning event", { error });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Client lifecycle
  // -----------------------------------------------------------------------

  private async ensureClient(): Promise<LettaClientLike> {
    if (this.clientLoader.current) {
      return this.clientLoader.get();
    }

    const cooldownMs = 2_000;
    const elapsed = Date.now() - this.lastInitFailure;
    if (this.lastInitFailure > 0 && elapsed < cooldownMs) {
      throw new Error(
        `Letta client init failed recently (${elapsed}ms ago). Retrying after ${cooldownMs}ms cooldown.`,
      );
    }

    return this.clientLoader.get();
  }

  private async createClient(): Promise<LettaClientLike> {
    const factory =
      this.clientFactory ??
      (await loadLettaClientFactory({
        apiKey: this.lettaApiKey,
        baseUrl: this.lettaBaseUrl,
      }));
    return factory();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function selectCompleteExchanges(history: LettaMessages): LettaMessages {
  const complete: LettaMessages = [];

  let index = 0;
  while (index < history.length) {
    const current = history[index];

    if (current.role === "user" && current.content) {
      const next = history[index + 1];
      if (next && next.role === "assistant" && next.content) {
        complete.push(current);
        complete.push(next);
        index += 2;
        continue;
      }

      index += 1;
      continue;
    }

    index += 1;
  }

  return complete;
}

function buildUserMessage(input: {
  content: string;
  participantsMessage: string | null;
  contactsMessage: string | null;
}): string {
  const updates: string[] = [];
  if (input.participantsMessage) {
    updates.push(`[System Update]: ${input.participantsMessage}`);
  }
  if (input.contactsMessage) {
    updates.push(`[System Update]: ${input.contactsMessage}`);
  }

  if (updates.length === 0) {
    return input.content;
  }

  return `${updates.join("\n\n")}\n\n${input.content}`;
}

async function loadLettaClientFactory(config: {
  apiKey?: string;
  baseUrl?: string;
}): Promise<LettaClientFactory> {
  const module = (await import("@letta-ai/letta-client").catch(
    (error: unknown) => {
      throw new UnsupportedFeatureError(
        `LettaAdapter requires optional dependency @letta-ai/letta-client. Install it with "pnpm add @letta-ai/letta-client". (${error instanceof Error ? error.message : String(error)})`,
      );
    },
  )) as {
    default?: new (options?: {
      apiKey?: string;
      baseURL?: string;
    }) => LettaClientLike;
    Letta?: new (options?: {
      apiKey?: string;
      baseURL?: string;
    }) => LettaClientLike;
  };

  const LettaCtor = module.default ?? module.Letta;
  if (!LettaCtor) {
    throw new UnsupportedFeatureError(
      'LettaAdapter requires optional dependency @letta-ai/letta-client. Install it with "pnpm add @letta-ai/letta-client".',
    );
  }

  return async () =>
    new LettaCtor({
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
}

export {
  LettaHistoryConverter,
  type LettaMessage,
  type LettaMessages,
};
