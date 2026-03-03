import { pathToFileURL } from "node:url";

import { A2AAdapter, Agent, type RestApi } from "../src/index";

function isDirectExecution(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  return importMetaUrl === pathToFileURL(entry).href;
}

function requireA2ARemoteUrl(optionsRemoteUrl?: string): string {
  const remoteUrl = optionsRemoteUrl ?? process.env.A2A_AGENT_URL;
  if (!remoteUrl) {
    throw new Error("A2A remote URL is required. Set A2A_AGENT_URL or pass options.remoteUrl.");
  }

  return remoteUrl;
}

class A2AAuthExampleRestApi implements RestApi {
  public async getAgentMe() {
    return {
      id: "agent-a2a-auth",
      name: "A2A Bridge Agent (Auth)",
      description: "Bridges Thenvoi chat to an authenticated A2A agent",
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

export function createA2ABridgeAgentWithAuth(options?: {
  remoteUrl?: string;
  apiKey?: string;
  bearerToken?: string;
}): Agent {
  const remoteUrl = requireA2ARemoteUrl(options?.remoteUrl);
  const apiKey = options?.apiKey ?? process.env.A2A_API_KEY;
  const bearerToken = options?.bearerToken ?? process.env.A2A_BEARER_TOKEN;

  const adapter = new A2AAdapter({
    remoteUrl,
    auth: {
      ...(apiKey ? { apiKey } : {}),
      ...(bearerToken ? { bearerToken } : {}),
    },
    streaming: true,
  });

  return Agent.create({
    adapter,
    agentId: "agent-a2a-auth",
    apiKey: "api-key",
    linkOptions: {
      restApi: new A2AAuthExampleRestApi(),
    },
  });
}

if (isDirectExecution(import.meta.url)) {
  void createA2ABridgeAgentWithAuth().run();
}
