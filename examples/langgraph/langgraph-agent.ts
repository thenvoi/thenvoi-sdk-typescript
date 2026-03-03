import { pathToFileURL } from "node:url";

import { Agent, LangGraphAdapter, type LangGraphGraph, type RestApi } from "../../src/index";

class LangGraphExampleRestApi implements RestApi {
  public async getAgentMe() {
    return { id: "agent-langgraph", name: "LangGraph Agent", description: "LangGraph integration example" };
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

export class EchoLangGraph implements LangGraphGraph {
  public async invoke(input: Record<string, unknown>): Promise<unknown> {
    const messages = Array.isArray(input.messages) ? input.messages : [];
    const latest = messages[messages.length - 1];
    if (Array.isArray(latest) && latest[0] === "user") {
      return {
        messages: [["assistant", `Echo from LangGraph: ${String(latest[1] ?? "")}`]],
      };
    }

    return {
      messages: [["assistant", "Echo from LangGraph"]],
    };
  }
}

export function createLangGraphAgent(options?: { graph?: LangGraphGraph }): Agent {
  const adapter = new LangGraphAdapter({
    graph: options?.graph ?? new EchoLangGraph(),
    customSection: "Use Thenvoi tools for side effects and final replies.",
    emitExecutionEvents: true,
  });

  return Agent.create({
    adapter,
    agentId: "agent-langgraph",
    apiKey: "api-key",
    linkOptions: {
      restApi: new LangGraphExampleRestApi(),
    },
  });
}

if (isDirectExecution(import.meta.url)) {
  void createLangGraphAgent().run();
}
