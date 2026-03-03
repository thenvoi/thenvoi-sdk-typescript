import { pathToFileURL } from "node:url";

import { Agent, ClaudeSDKAdapter, type RestApi } from "../../src/index";

class ClaudeSdkExampleRestApi implements RestApi {
  public async getAgentMe() {
    return {
      id: "claude-sdk-agent",
      name: "Claude SDK Agent",
      description: "Claude SDK adapter example",
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

interface ClaudeSdkExampleOptions {
  model?: string;
  cwd?: string;
}

export function createClaudeSdkAgent(
  options: ClaudeSdkExampleOptions = {},
): Agent {
  const adapter = new ClaudeSDKAdapter({
    model: options.model ?? "claude-sonnet-4-5-20250929",
    cwd: options.cwd,
    permissionMode: "acceptEdits",
    enableMcpTools: true,
  });

  return Agent.create({
    adapter,
    agentId: "claude-sdk-agent",
    apiKey: "api-key",
    linkOptions: {
      restApi: new ClaudeSdkExampleRestApi(),
    },
  });
}

if (isDirectExecution(import.meta.url)) {
  void createClaudeSdkAgent().run();
}
