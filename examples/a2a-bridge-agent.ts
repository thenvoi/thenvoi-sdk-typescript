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

export class A2AExampleRestApi implements RestApi {
  public async getAgentMe() {
    return {
      id: "agent-a2a",
      name: "A2A Bridge Agent",
      description: "Bridges Thenvoi chat to a remote A2A agent",
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

export function createA2ABridgeAgent(options?: { remoteUrl?: string }): Agent {
  const remoteUrl = requireA2ARemoteUrl(options?.remoteUrl);
  const adapter = new A2AAdapter({
    remoteUrl,
    streaming: true,
  });

  return Agent.create({
    adapter,
    agentId: "agent-a2a",
    apiKey: "api-key",
    linkOptions: {
      restApi: new A2AExampleRestApi(),
    },
  });
}

if (isDirectExecution(import.meta.url)) {
  void createA2ABridgeAgent().run();
}
