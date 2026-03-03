import { pathToFileURL } from "node:url";

import { Agent, OpenAIAdapter, type RestApi } from "../../src/index";

class OpenAIExampleRestApi implements RestApi {
  public async getAgentMe() {
    return {
      id: "openai-agent",
      name: "OpenAI Agent",
      description: "OpenAI adapter example",
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

interface OpenAIExampleOptions {
  model?: string;
  apiKey?: string;
}

export function createOpenAIAgent(options: OpenAIExampleOptions = {}): Agent {
  const adapter = new OpenAIAdapter({
    openAIModel: options.model ?? "gpt-4o-mini",
    apiKey: options.apiKey,
  });

  return Agent.create({
    adapter,
    agentId: "openai-agent",
    apiKey: "api-key",
    linkOptions: {
      restApi: new OpenAIExampleRestApi(),
    },
  });
}

if (isDirectExecution(import.meta.url)) {
  void createOpenAIAgent().run();
}
