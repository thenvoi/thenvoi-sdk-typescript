import { pathToFileURL } from "node:url";

import { Agent, GenericAdapter, type RestApi } from "../../src/index";

export class StubRestApi implements RestApi {
  public async getAgentMe() {
    return {
      id: "agent-1",
      name: "Example Agent",
      description: "Example",
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

export function createBasicAgent(): Agent {
  const adapter = new GenericAdapter(async ({ message, tools }) => {
    await tools.sendMessage(`Echo: ${message.content}`);
  });

  return Agent.create({
    adapter,
    agentId: "agent-1",
    apiKey: "api-key",
    linkOptions: {
      restApi: new StubRestApi(),
    },
  });
}

if (isDirectExecution(import.meta.url)) {
  void createBasicAgent().run();
}
