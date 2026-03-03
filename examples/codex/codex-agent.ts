import { pathToFileURL } from "node:url";

import { Agent, CodexAdapter, type CodexAdapterConfig, type RestApi } from "../../src/index";

class CodexExampleRestApi implements RestApi {
  public async getAgentMe() {
    return {
      id: "codex-agent",
      name: "Codex Agent",
      description: "Codex adapter example",
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

interface CodexExampleOptions {
  model?: string;
  cwd?: string;
  approvalPolicy?: CodexAdapterConfig["approvalPolicy"];
  sandboxMode?: CodexAdapterConfig["sandboxMode"];
  reasoningEffort?: CodexAdapterConfig["reasoningEffort"];
}

export function createCodexAgent(options: CodexExampleOptions = {}): Agent {
  const adapter = new CodexAdapter({
    config: {
      model: options.model ?? "gpt-5.3-codex",
      cwd: options.cwd,
      approvalPolicy: options.approvalPolicy ?? "never",
      sandboxMode: options.sandboxMode ?? "workspace-write",
      reasoningEffort: options.reasoningEffort,
      enableExecutionReporting: true,
      emitThoughtEvents: true,
      enableLocalCommands: true,
    },
  });

  return Agent.create({
    adapter,
    agentId: "codex-agent",
    apiKey: "api-key",
    linkOptions: {
      restApi: new CodexExampleRestApi(),
    },
  });
}

if (isDirectExecution(import.meta.url)) {
  void createCodexAgent().run();
}
