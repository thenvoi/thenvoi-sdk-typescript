import { pathToFileURL } from "node:url";

import { Agent, SimpleAdapter, type AdapterToolsProtocol, type HistoryProvider, type PlatformMessage, type RestApi } from "../src/index";

class EchoAdapter extends SimpleAdapter<HistoryProvider> {
  public async onMessage(
    message: PlatformMessage,
    tools: AdapterToolsProtocol,
  ): Promise<void> {
    await tools.sendMessage(`Custom adapter received: ${message.content}`);
  }
}

class StubRestApi implements RestApi {
  public async getAgentMe() {
    return { id: "agent-1", name: "Custom Agent", description: "Custom" };
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

export function createCustomAdapterAgent(options?: {
  agentId?: string;
  apiKey?: string;
  restApi?: RestApi;
}): Agent {
  return Agent.create({
    adapter: new EchoAdapter(),
    agentId: options?.agentId ?? "agent-1",
    apiKey: options?.apiKey ?? "api-key",
    linkOptions: {
      restApi: options?.restApi ?? new StubRestApi(),
    },
  });
}

if (isDirectExecution(import.meta.url)) {
  void createCustomAdapterAgent().run();
}
