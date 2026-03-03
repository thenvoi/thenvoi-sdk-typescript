import { pathToFileURL } from "node:url";

import { Agent, ParlantAdapter, type RestApi } from "../src/index";

export class ParlantExampleRestApi implements RestApi {
  public async getAgentMe() {
    return {
      id: "agent-parlant",
      name: "Parlant Agent",
      description: "Thenvoi adapter backed by parlant-client",
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

export function createParlantAgent(options: {
  environment: string;
  agentId: string;
  apiKey?: string;
}): Agent {
  const adapter = new ParlantAdapter({
    environment: options.environment,
    agentId: options.agentId,
    apiKey: options.apiKey,
  });

  return Agent.create({
    adapter,
    agentId: "agent-parlant",
    apiKey: "api-key",
    linkOptions: {
      restApi: new ParlantExampleRestApi(),
    },
  });
}

if (isDirectExecution(import.meta.url)) {
  const environment = process.env.PARLANT_ENVIRONMENT;
  const parlantAgentId = process.env.PARLANT_AGENT_ID;

  if (!environment || !parlantAgentId) {
    throw new Error(
      "Set PARLANT_ENVIRONMENT and PARLANT_AGENT_ID to run this example.",
    );
  }

  void createParlantAgent({
    environment,
    agentId: parlantAgentId,
    apiKey: process.env.PARLANT_API_KEY,
  }).run();
}
