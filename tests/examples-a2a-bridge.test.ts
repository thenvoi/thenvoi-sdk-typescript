import { describe, expect, it } from "vitest";

import { createA2ABridgeAgent, A2AExampleRestApi } from "../examples/a2a-bridge-agent";
import { createA2ABridgeAgentWithAuth } from "../examples/a2a-bridge-auth";

describe("a2a bridge examples", () => {
  it("builds an A2A bridge agent without import-time side effects", () => {
    const agent = createA2ABridgeAgent({ remoteUrl: "a2a-remote" });
    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe("function");
    expect(typeof agent.stop).toBe("function");
  });

  it("builds an authenticated A2A bridge agent", () => {
    const agent = createA2ABridgeAgentWithAuth({
      remoteUrl: "a2a-remote",
      apiKey: "secret",
    });
    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe("function");
  });

  it("provides a reusable REST stub for local A2A example runs", async () => {
    const rest = new A2AExampleRestApi();
    await expect(rest.getAgentMe()).resolves.toMatchObject({
      id: "agent-a2a",
      name: "A2A Bridge Agent",
    });
  });
});
