import { describe, expect, it } from "vitest";

import {
  A2AGatewayExampleRestApi,
  createA2AGatewayAgent,
} from "../examples/a2a-gateway/a2a-gateway-agent";
import {
  ParlantExampleRestApi,
  createParlantAgent,
} from "../examples/parlant/parlant-agent";

describe("gateway/parlant examples", () => {
  it("builds an A2A gateway agent without import-time side effects", () => {
    const agent = createA2AGatewayAgent({
      port: 10_001,
      gatewayUrl: "http://localhost:10001",
    });

    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe("function");
  });

  it("builds a Parlant adapter agent without import-time side effects", () => {
    const agent = createParlantAgent({
      environment: "https://parlant.example",
      agentId: "agent-123",
    });

    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe("function");
    expect(typeof agent.stop).toBe("function");
  });

  it("provides reusable example REST stubs", async () => {
    const gatewayRest = new A2AGatewayExampleRestApi();
    await expect(gatewayRest.getAgentMe()).resolves.toMatchObject({
      id: "agent-a2a-gateway",
    });

    const parlantRest = new ParlantExampleRestApi();
    await expect(parlantRest.getAgentMe()).resolves.toMatchObject({
      id: "agent-parlant",
    });
  });
});
