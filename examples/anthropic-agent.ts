import { pathToFileURL } from "node:url";

import { Agent, AnthropicAdapter, type RestApi } from "../src/index";

class AnthropicExampleRestApi implements RestApi {
  public async getAgentMe() {
    return {
      id: "anthropic-agent",
      name: "Anthropic Agent",
      description: "Anthropic adapter example",
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

interface AnthropicExampleOptions {
  model?: string;
  apiKey?: string;
}

export function createAnthropicAgent(options: AnthropicExampleOptions = {}): Agent {
  const adapter = new AnthropicAdapter({
    anthropicModel: options.model ?? "claude-sonnet-4-5",
    apiKey: options.apiKey,
  });

  return Agent.create({
    adapter,
    agentId: "anthropic-agent",
    apiKey: "api-key",
    linkOptions: {
      restApi: new AnthropicExampleRestApi(),
    },
  });
}

if (isDirectExecution(import.meta.url)) {
  void createAnthropicAgent().run();
}
