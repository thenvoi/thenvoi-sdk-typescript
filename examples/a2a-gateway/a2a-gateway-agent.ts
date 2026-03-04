import { A2AGatewayAdapter, Agent, FernRestAdapter, loadAgentConfig, isDirectExecution } from "../../src/index";
import { ThenvoiClient } from "@thenvoi/rest-client";

export function createA2AGatewayAgent(
  options?: { port?: number; gatewayUrl?: string },
  overrides?: { agentId?: string; apiKey?: string },
): Agent {
  const thenvoiApiKey = overrides?.apiKey ?? "api-key";
  const restApi = new FernRestAdapter(
    new ThenvoiClient({ apiKey: thenvoiApiKey }),
  );

  const adapter = new A2AGatewayAdapter({
    thenvoiRest: restApi,
    port: options?.port,
    gatewayUrl: options?.gatewayUrl,
  });

  return Agent.create({
    adapter,
    agentId: overrides?.agentId ?? "agent-a2a-gateway",
    apiKey: thenvoiApiKey,
    linkOptions: { restApi },
  });
}

if (isDirectExecution(import.meta.url)) {
  const config = loadAgentConfig("a2a_gateway_agent");
  void createA2AGatewayAgent(undefined, config).run();
}
