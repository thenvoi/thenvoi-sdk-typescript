import { pathToFileURL } from "node:url";

import { LinearClient } from "@linear/sdk";

import {
  Agent,
  GenericAdapter,
  type RestApi,
  postFinalResponseToLinearSession,
} from "../../src/index";

interface LinearContextMetadata {
  sessionId: string;
  issueId: string | null;
  action: string;
  promptContext: string | null;
}

interface LinearThenvoiOrchestratorAgentOptions {
  agentId?: string;
  apiKey?: string;
  restApi?: RestApi;
  linearAccessToken?: string;
  hostHandle?: string;
  defaultSpecialistHandles?: string[];
  maxProcessedMessageIds?: number;
}

class LinearThenvoiOrchestratorRestApi implements RestApi {
  public async getAgentMe() {
    return {
      id: "agent-linear-thenvoi-orchestrator",
      name: "Linear Thenvoi Orchestrator",
      description: "Coordinates Thenvoi specialists for Linear sessions",
    };
  }

  public async createChatMessage() {
    return { ok: true };
  }

  public async createChatEvent() {
    return { ok: true };
  }

  public async createChat() {
    return { id: "room-1" };
  }

  public async listChatParticipants() {
    return [];
  }

  public async addChatParticipant() {
    return { ok: true };
  }

  public async removeChatParticipant() {
    return { ok: true };
  }

  public async markMessageProcessing() {
    return { ok: true };
  }

  public async markMessageProcessed() {
    return { ok: true };
  }

  public async markMessageFailed() {
    return { ok: true };
  }

  public async listPeers() {
    return { data: [] };
  }
}

function isDirectExecution(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  return importMetaUrl === pathToFileURL(entry).href;
}

export function createLinearThenvoiOrchestratorAgent(
  options?: LinearThenvoiOrchestratorAgentOptions,
): Agent {
  const linearClient = new LinearClient({
    accessToken: options?.linearAccessToken ?? process.env.LINEAR_ACCESS_TOKEN ?? "linear-api-key",
  });

  const processedMessageIds = new Set<string>();
  const processedMessageOrder: string[] = [];
  const maxProcessed = options?.maxProcessedMessageIds ?? 500;
  const defaultSpecialists = dedupeHandles(options?.defaultSpecialistHandles ?? []);

  const adapter = new GenericAdapter(async ({ message, tools }) => {
    if (processedMessageIds.has(message.id)) {
      return;
    }

    trackProcessedMessageId({
      id: message.id,
      processedMessageIds,
      processedMessageOrder,
      maxProcessed,
    });

    const metadata = parseLinearMetadata(message.metadata);
    if (!metadata || metadata.action === "canceled") {
      return;
    }

    const specialistHandles = dedupeHandles([
      ...defaultSpecialists,
      ...extractMentionHandles(message.content),
    ]).filter((handle) => handle !== normalizeHandle(options?.hostHandle ?? "linear-host"));

    for (const specialistHandle of specialistHandles) {
      try {
        await tools.addParticipant(specialistHandle, "member");
      } catch {
        // Best-effort in example: addParticipant may fail when peer lookup is unavailable.
      }
    }

    if (specialistHandles.length > 0) {
      await tools.sendMessage(
        `[Coordinator] Inviting specialist agents for this Linear session: ${specialistHandles
          .map((handle) => `@${handle}`)
          .join(", ")}`,
      );
    }

    const finalResponse = buildFinalResponse({
      issueId: metadata.issueId,
      promptContext: metadata.promptContext,
      specialistHandles,
      hostHandle: options?.hostHandle ?? "linear-host",
    });

    await tools.sendMessage(finalResponse);

    await postFinalResponseToLinearSession({
      linearClient,
      agentSessionId: metadata.sessionId,
      body: finalResponse,
    });
  });

  return Agent.create({
    adapter,
    agentId: options?.agentId ?? "agent-linear-thenvoi-orchestrator",
    apiKey: options?.apiKey ?? "api-key",
    linkOptions: {
      restApi: options?.restApi ?? new LinearThenvoiOrchestratorRestApi(),
    },
  });
}

function parseLinearMetadata(metadata: Record<string, unknown>): LinearContextMetadata | null {
  if (metadata.linear_bridge !== "thenvoi") {
    return null;
  }

  const sessionId = metadata.linear_session_id;
  const action = metadata.linear_event_action;

  if (typeof sessionId !== "string" || typeof action !== "string") {
    return null;
  }

  return {
    sessionId,
    issueId: typeof metadata.linear_issue_id === "string" ? metadata.linear_issue_id : null,
    action,
    promptContext:
      typeof metadata.linear_prompt_context === "string"
        ? metadata.linear_prompt_context
        : null,
  };
}

function buildFinalResponse(input: {
  issueId: string | null;
  promptContext: string | null;
  specialistHandles: string[];
  hostHandle: string;
}): string {
  const scope = input.issueId ? `issue ${input.issueId}` : "this Linear request";
  const context = input.promptContext?.trim() ?? "";
  const snippet = context.length > 0 ? context.slice(0, 400) : "No prompt context was provided.";
  const specialists = input.specialistHandles.length > 0
    ? ` Specialists involved: ${input.specialistHandles.map((handle) => `@${handle}`).join(", ")}.`
    : "";

  return `@${normalizeHandle(input.hostHandle)} completed orchestration for ${scope}.${specialists}\n\nSummary:\n${snippet}`;
}

function extractMentionHandles(content: string): string[] {
  const matches = content.matchAll(/@([a-zA-Z0-9_.-]+)/g);
  const handles: string[] = [];

  for (const match of matches) {
    const handle = match[1];
    if (!handle) {
      continue;
    }

    handles.push(handle);
  }

  return dedupeHandles(handles);
}

function dedupeHandles(handles: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const handle of handles) {
    const normalized = normalizeHandle(handle);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
}

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, "").toLowerCase();
}

function trackProcessedMessageId(input: {
  id: string;
  processedMessageIds: Set<string>;
  processedMessageOrder: string[];
  maxProcessed: number;
}): void {
  input.processedMessageIds.add(input.id);
  input.processedMessageOrder.push(input.id);

  while (input.processedMessageOrder.length > input.maxProcessed) {
    const stale = input.processedMessageOrder.shift();
    if (!stale) {
      break;
    }

    input.processedMessageIds.delete(stale);
  }
}

if (isDirectExecution(import.meta.url)) {
  void createLinearThenvoiOrchestratorAgent().run();
}
