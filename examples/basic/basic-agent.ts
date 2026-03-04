import { Agent, GenericAdapter, loadAgentConfig, isDirectExecution } from "../../src/index";

export function createBasicAgent(overrides?: { agentId?: string; apiKey?: string }): Agent {
  const adapter = new GenericAdapter(async ({ message, tools }) => {
    await tools.sendMessage(`Echo: ${message.content}`);
  });

  return Agent.create({
    adapter,
    agentId: overrides?.agentId ?? "basic-agent",
    apiKey: overrides?.apiKey ?? "api-key",
  });
}

if (isDirectExecution(import.meta.url)) {
  const config = loadAgentConfig("basic_agent");
  void createBasicAgent(config).run();
}
