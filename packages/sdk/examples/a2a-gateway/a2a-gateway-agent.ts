import { A2AGatewayAdapter, Agent, loadAgentConfig, isDirectExecution } from "../../src/index";
import { FernRestAdapter } from "../../src/rest";
import { ThenvoiClient } from "@thenvoi/rest-client";

export function createA2AGatewayAgent(
  options?: { port?: number; gatewayUrl?: string; authToken?: string },
  overrides?: { agentId?: string; apiKey?: string; wsUrl?: string; restUrl?: string },
): Agent {
  const thenvoiApiKey = overrides?.apiKey ?? "api-key";
  const restApi = new FernRestAdapter(
    new ThenvoiClient({
      apiKey: thenvoiApiKey,
      ...(overrides?.restUrl ? { baseUrl: overrides.restUrl } : {}),
    }),
  );

  const adapter = new A2AGatewayAdapter({
    thenvoiRest: restApi,
    port: options?.port,
    gatewayUrl: options?.gatewayUrl,
    authToken: options?.authToken ?? thenvoiApiKey,
  });

  return Agent.create({
    adapter,
    config: {
      agentId: overrides?.agentId ?? "agent-a2a-gateway",
      apiKey: thenvoiApiKey,
      ...(overrides?.wsUrl ? { wsUrl: overrides.wsUrl } : {}),
      ...(overrides?.restUrl ? { restUrl: overrides.restUrl } : {}),
    },
    linkOptions: { restApi },
    agentConfig: { autoSubscribeExistingRooms: true },
  });
}

if (isDirectExecution(import.meta.url)) {
  const config = loadAgentConfig("a2a_gateway_agent");
  void createA2AGatewayAgent(undefined, config).run();
}
