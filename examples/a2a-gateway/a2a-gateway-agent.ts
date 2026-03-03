import { pathToFileURL } from "node:url";

import { A2AGatewayAdapter, Agent, type RestApi } from "../../src/index";

function isDirectExecution(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  return importMetaUrl === pathToFileURL(entry).href;
}

export class A2AGatewayExampleRestApi implements RestApi {
  public async getAgentMe() {
    return {
      id: "agent-a2a-gateway",
      name: "A2A Gateway Agent",
      description: "Exposes Thenvoi peers as A2A endpoints",
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
    return {
      data: [
        {
          id: "peer-weather",
          name: "Weather Agent",
          handle: "weather-agent",
          description: "Weather specialist",
        },
      ],
    };
  }
}

export function createA2AGatewayAgent(options?: {
  port?: number;
  gatewayUrl?: string;
}): Agent {
  const restApi = new A2AGatewayExampleRestApi();
  const adapter = new A2AGatewayAdapter({
    thenvoiRest: restApi,
    port: options?.port,
    gatewayUrl: options?.gatewayUrl,
  });

  return Agent.create({
    adapter,
    agentId: "agent-a2a-gateway",
    apiKey: "api-key",
    linkOptions: {
      restApi,
    },
  });
}

if (isDirectExecution(import.meta.url)) {
  void createA2AGatewayAgent().run();
}
