import { Agent, AnthropicAdapter, loadAgentConfig, isDirectExecution } from "../../src/index";

interface AnthropicExampleOptions {
  model?: string;
  apiKey?: string;
}

export function createAnthropicAgent(
  options: AnthropicExampleOptions = {},
  overrides?: { agentId?: string; apiKey?: string },
): Agent {
  const adapter = new AnthropicAdapter({
    anthropicModel: options.model ?? "claude-sonnet-4-6",
    apiKey: options.apiKey,
  });

  return Agent.create({
    adapter,
    agentId: overrides?.agentId ?? "anthropic-agent",
    apiKey: overrides?.apiKey ?? "api-key",
  });
}

if (isDirectExecution(import.meta.url)) {
  const config = loadAgentConfig("anthropic_agent");
  void createAnthropicAgent({}, config).run();
}
