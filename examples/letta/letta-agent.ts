import { Agent, LettaAdapter, loadAgentConfig, isDirectExecution } from "../../src/index";

export function createLettaAgent(
  options: {
    model?: string;
    lettaApiKey?: string;
    lettaBaseUrl?: string;
  },
  overrides?: { agentId?: string; apiKey?: string },
): Agent {
  const adapter = new LettaAdapter({
    model: options.model ?? "openai/gpt-4o",
    lettaApiKey: options.lettaApiKey,
    lettaBaseUrl: options.lettaBaseUrl,
  });

  return Agent.create({
    adapter,
    config: {
      agentId: overrides?.agentId ?? "agent-letta",
      apiKey: overrides?.apiKey ?? "api-key",
    },
  });
}

if (isDirectExecution(import.meta.url)) {
  const lettaApiKey = process.env.LETTA_API_KEY;
  const lettaBaseUrl = process.env.LETTA_BASE_URL;

  if (!lettaApiKey && !lettaBaseUrl) {
    throw new Error(
      "Set LETTA_API_KEY (cloud) or LETTA_BASE_URL (self-hosted) to run this example.",
    );
  }

  const config = loadAgentConfig("letta_agent");
  void createLettaAgent(
    {
      model: process.env.LETTA_MODEL,
      lettaApiKey,
      lettaBaseUrl,
    },
    config,
  ).run();
}
