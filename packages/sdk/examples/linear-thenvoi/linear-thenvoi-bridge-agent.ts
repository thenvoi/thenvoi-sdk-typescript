import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Agent,
  type AgentCreateOptions,
  CodexAdapter,
  type FrameworkAdapter,
  type SessionConfig,
  loadAgentConfig,
  isDirectExecution,
} from "@thenvoi/sdk";
import {
  createLinearClient,
  createLinearTools,
  createSqliteSessionRoomStore,
  type LinearActivityClient,
  type SessionRoomStore,
} from "@thenvoi/sdk/linear";
import type { Logger } from "@thenvoi/sdk/core";

interface LinearThenvoiBridgeAgentOptions {
  agentId?: string;
  apiKey?: string;
  wsUrl?: string;
  restUrl?: string;
  adapter?: FrameworkAdapter;
  linearAccessToken?: string;
  linearClient?: LinearActivityClient;
  stateDbPath?: string;
  store?: SessionRoomStore;
  codexModel?: string;
  name?: string;
  description?: string | null;
  logger?: Logger;
  linkOptions?: AgentCreateOptions["linkOptions"];
  sessionConfig?: SessionConfig;
}

export function createLinearThenvoiBridgeAgent(
  options?: LinearThenvoiBridgeAgentOptions,
): Agent {
  const store = options?.store ?? createLinearThenvoiBridgeStore(options?.stateDbPath);
  return createLinearThenvoiBridgeAgentWithStore({ ...options, store });
}

function createLinearThenvoiBridgeAgentWithStore(
  options: LinearThenvoiBridgeAgentOptions & { store: SessionRoomStore },
): Agent {
  const linearClient = options?.linearClient ?? createLinearClient(
    options?.linearAccessToken ?? process.env.LINEAR_ACCESS_TOKEN ?? "linear-api-key",
  );

  const linearTools = createLinearTools({
    client: linearClient,
    store: options.store,
    enableElicitation: false,
  });

  const adapter: FrameworkAdapter = options?.adapter ?? new CodexAdapter({
    config: {
      model: options?.codexModel ?? process.env.CODEX_MODEL ?? "gpt-5.4-mini",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      enableExecutionReporting: true,
      emitThoughtEvents: true,
      customSection: buildLinearThenvoiBridgePrompt(),
    },
    customTools: linearTools,
  });

  return Agent.create({
    adapter,
    wsUrl: options?.wsUrl,
    restUrl: options?.restUrl,
    linkOptions: options?.linkOptions,
    logger: options?.logger,
    sessionConfig: options?.sessionConfig,
    config: {
      agentId: options?.agentId ?? "agent-linear-thenvoi-bridge",
      apiKey: options?.apiKey ?? "api-key",
    },
    agentConfig: {
      autoSubscribeExistingRooms: false,
    },
    identity: {
      name: options?.name ?? "Thenvoi Linear Bridge",
      description: options?.description ?? "Linear bridge agent coordinating Thenvoi specialists",
    },
  });
}

function createLinearThenvoiBridgeStore(stateDbPath?: string): SessionRoomStore {
  return createSqliteSessionRoomStore(
    stateDbPath ?? process.env.LINEAR_THENVOI_STATE_DB ?? ".linear-thenvoi-example.sqlite",
  );
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export function buildLinearThenvoiBridgePrompt(): string {
  const promptPath = process.env.LINEAR_THENVOI_PROMPT_PATH
    ?? join(__dirname, "prompt.md");

  return readFileSync(promptPath, "utf-8").trim();
}

async function runLinearThenvoiBridgeDirect(options?: LinearThenvoiBridgeAgentOptions): Promise<void> {
  const store = createLinearThenvoiBridgeStore(options?.stateDbPath);
  const agent = createLinearThenvoiBridgeAgentWithStore({
    ...options,
    store,
  });

  try {
    await agent.start();
    await agent.runForever();
  } finally {
    await agent.stop();
    await store.close?.();
  }
}

if (isDirectExecution(import.meta.url)) {
  const config = loadAgentConfig("linear_thenvoi_bridge");
  void runLinearThenvoiBridgeDirect({
    ...config,
  });
}
