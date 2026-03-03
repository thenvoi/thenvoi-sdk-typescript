import { pathToFileURL } from "node:url";

import {
  Agent,
  type FrameworkAdapter,
  type RestApi,
} from "../src/index";
import type { AgentIdentity, PaginatedResponse } from "../src/client/rest/types";
import type { PeerRecord } from "../src/contracts/dtos";

interface CreateExampleAgentOptions {
  adapter: FrameworkAdapter;
  agentId: string;
  restApi: RestApi;
  apiKey?: string;
}

export function createExampleAgent(options: CreateExampleAgentOptions): Agent {
  return Agent.create({
    adapter: options.adapter,
    agentId: options.agentId,
    apiKey: options.apiKey ?? "api-key",
    linkOptions: {
      restApi: options.restApi,
    },
  });
}

export function isDirectExecution(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  return importMetaUrl === pathToFileURL(entry).href;
}

export function requireA2ARemoteUrl(optionsRemoteUrl?: string): string {
  const remoteUrl = optionsRemoteUrl ?? process.env.A2A_AGENT_URL;
  if (!remoteUrl) {
    throw new Error("A2A remote URL is required. Set A2A_AGENT_URL or pass options.remoteUrl.");
  }

  return remoteUrl;
}

export class ExampleRestApi implements RestApi {
  private readonly identity: AgentIdentity;

  public constructor(identity: AgentIdentity) {
    this.identity = identity;
  }

  public async getAgentMe(): Promise<AgentIdentity> {
    return this.identity;
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

  public async listPeers(): Promise<PaginatedResponse<PeerRecord>> {
    return { data: [] };
  }
}
