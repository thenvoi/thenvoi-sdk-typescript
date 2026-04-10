import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { AgentIdentity } from "../client/rest/types";
import type { AdapterToolsProtocol } from "../contracts/protocols";
import { mcpToolNames } from "../runtime/tools/schemas";
import {
  buildRoomScopedRegistrations,
  type McpToolRegistration,
} from "./registrations";
import { buildZodShape } from "./zod";

export interface CreateThenvoiSdkMcpServerOptions {
  enableMemoryTools: boolean;
  getToolsForRoom: (roomId: string) => AdapterToolsProtocol | undefined;
  additionalTools?: McpToolRegistration[];
}

interface GetSystemPromptContextResult {
  roomId: string;
  roomTitle: string | null;
  agent: {
    id: string;
    name: string;
    handle: string | null;
    description: string | null;
  };
  participants: Array<{
    id: string;
    name: string;
    type: string;
    handle: string | null;
    isSelf: boolean;
  }>;
  mentionFormat: string;
  markdown: string;
}

export interface GetSystemPromptContextOptions {
  ttlMs?: number;
}

export interface ThenvoiSdkMcpServer {
  serverConfig: McpSdkServerConfigWithInstance;
  allowedTools: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches SDK's own SdkMcpToolDefinition<any> signature
  toolDefinitions: Array<SdkMcpToolDefinition<any>>;
  getSystemPromptContext(roomId: string, options?: GetSystemPromptContextOptions): Promise<string>;
}

export function createThenvoiSdkMcpServer(
  options: CreateThenvoiSdkMcpServerOptions,
): ThenvoiSdkMcpServer {
  const registrations = buildRoomScopedRegistrations(
    options.getToolsForRoom,
    {
      enableMemoryTools: options.enableMemoryTools,
      enableContactTools: true,
      additionalTools: options.additionalTools,
    },
  );

  const toolDefinitions = registrations.map(toSdkToolDefinition);
  const toolNames = new Set(registrations.map((r) => r.name));
  const contextCache = new Map<string, { value: string; expiresAt: number }>();

  const serverConfig = createSdkMcpServer({
    name: "thenvoi",
    tools: toolDefinitions,
  });

  return {
    serverConfig,
    allowedTools: mcpToolNames(toolNames),
    toolDefinitions,
    getSystemPromptContext: async (roomId, contextOptions) => {
      const ttlMs = contextOptions?.ttlMs ?? 30_000;
      const now = Date.now();
      const cached = contextCache.get(roomId);
      if (cached && cached.expiresAt > now) {
        return cached.value;
      }
      // Evict the stale entry so it doesn't accumulate indefinitely.
      if (cached) {
        contextCache.delete(roomId);
      }

      const tools = options.getToolsForRoom(roomId);
      if (!tools) {
        throw new Error(`No tool context found for room_id ${roomId}`);
      }

      const context = await buildSystemPromptContext(roomId, tools);
      contextCache.set(roomId, {
        value: context.markdown,
        expiresAt: now + ttlMs,
      });
      return context.markdown;
    },
  };
}

async function buildSystemPromptContext(
  roomId: string,
  tools: AdapterToolsProtocol,
): Promise<GetSystemPromptContextResult> {
  const participants = await tools.getParticipants();
  // Resolve agent identity and room title independently; fall back gracefully if either fails
  // (e.g. REST unavailable) so the caller still gets a usable context block.
  const agentIdentity = await resolveAgentIdentity(tools).catch(() => null);
  const roomTitle = await resolveRoomTitle(tools, roomId).catch(() => null);
  const normalizedParticipants = participants.map((participant) => ({
    id: String(participant.id),
    name: String(participant.name ?? "Unknown"),
    type: String(participant.type ?? "Unknown"),
    handle: normalizeHandle(participant.handle),
    isSelf: participant.id === agentIdentity?.id,
  }));
  const selfHandle = normalizeHandle(agentIdentity?.handle);
  const selfName = agentIdentity?.name ?? "Agent";
  const mentionHandles = normalizedParticipants
    .map((participant) => participant.handle)
    .filter((handle): handle is string => Boolean(handle));
  const mentionFormat = mentionHandles.length > 0 ? mentionHandles.join(", ") : "No participant handles available";
  const roomLabel = roomTitle ? `\"${roomTitle}\"` : "this room";
  const agentLabel = selfHandle ? `${selfName} (${selfHandle})` : selfName;
  const participantLines = normalizedParticipants.length > 0
    ? normalizedParticipants.map((participant) => {
        const suffix = participant.isSelf ? " (you)" : "";
        const handle = participant.handle ? ` (${participant.handle})` : "";
        return `- **${participant.name}**${handle} -- ${participant.type}${suffix}`;
      }).join("\n")
    : "- No participants found";

  const markdown = [
    "## Room Context",
    "",
    `You are **${agentLabel}** in room ${roomLabel} (id: ${roomId}).`,
    "",
    "### Participants",
    participantLines,
    "",
    "### Mention Format",
    `To address someone, use their exact handle: ${mentionFormat}`,
  ].join("\n");

  return {
    roomId,
    roomTitle,
    agent: {
      id: agentIdentity?.id ?? "unknown-agent",
      name: selfName,
      handle: selfHandle,
      description: agentIdentity?.description ?? null,
    },
    participants: normalizedParticipants,
    mentionFormat,
    markdown,
  };
}

async function resolveAgentIdentity(tools: AdapterToolsProtocol): Promise<AgentIdentity | null> {
  // AdapterToolsProtocol doesn't surface agent identity directly. We duck-type two
  // known extension points: a dedicated `getAgentIdentity()` method (future-facing) and
  // `rest.getAgentMe()` which concrete adapters (e.g. FernRestAdapter) expose.
  const maybeTools = tools as AdapterToolsProtocol & {
    getAgentIdentity?: () => Promise<AgentIdentity>;
    rest?: { getAgentMe?: () => Promise<AgentIdentity> };
  };

  if (maybeTools.getAgentIdentity) {
    return maybeTools.getAgentIdentity();
  }

  if (maybeTools.rest?.getAgentMe) {
    return maybeTools.rest.getAgentMe();
  }

  return null;
}

async function resolveRoomTitle(tools: AdapterToolsProtocol, roomId: string): Promise<string | null> {
  const maybeTools = tools as AdapterToolsProtocol & {
    rest?: {
      listChats?: (request: { page: number; pageSize: number }) => Promise<{ data?: Array<Record<string, unknown>> }>;
    };
  };

  // TODO: replace with a direct getChat(roomId) call once the Fern REST client exposes one.
  // For now we page the first 100 chats, which covers typical deployments.
  const response = await maybeTools.rest?.listChats?.({ page: 1, pageSize: 100 });
  const room = response?.data?.find((entry) => entry.id === roomId);
  return typeof room?.title === "string" && room.title.length > 0 ? room.title : null;
}

function normalizeHandle(handle: string | null | undefined): string | null {
  return typeof handle === "string" && handle.trim().length > 0 ? handle.trim() : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches SDK's own SdkMcpToolDefinition<any> signature
function toSdkToolDefinition(registration: McpToolRegistration): SdkMcpToolDefinition<any> {
  const shape = buildZodShape(
    z,
    registration.inputSchema.properties,
    new Set(registration.inputSchema.required),
  );

  return tool(
    registration.name,
    registration.description,
    shape,
    async (args: Record<string, unknown>) => registration.execute(args),
  );
}
