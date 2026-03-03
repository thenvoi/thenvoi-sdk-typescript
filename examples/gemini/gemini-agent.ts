import { pathToFileURL } from "node:url";

import { Agent, GeminiAdapter, type RestApi } from "../../src/index";

class GeminiExampleRestApi implements RestApi {
  public async getAgentMe() {
    return {
      id: "gemini-agent",
      name: "Gemini Agent",
      description: "Gemini adapter example",
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

interface GeminiExampleOptions {
  model?: string;
  apiKey?: string;
}

export function createGeminiAgent(options: GeminiExampleOptions = {}): Agent {
  const adapter = new GeminiAdapter({
    geminiModel: options.model ?? "gemini-2.5-flash",
    apiKey: options.apiKey,
  });

  return Agent.create({
    adapter,
    agentId: "gemini-agent",
    apiKey: "api-key",
    linkOptions: {
      restApi: new GeminiExampleRestApi(),
    },
  });
}

if (isDirectExecution(import.meta.url)) {
  void createGeminiAgent().run();
}
