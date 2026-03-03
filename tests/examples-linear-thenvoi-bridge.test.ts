import { describe, expect, it } from "vitest";

import { createLinearThenvoiBridgeApp } from "../examples/linear-thenvoi-bridge-server";
import { createLinearThenvoiOrchestratorAgent } from "../examples/linear-thenvoi-orchestrator-agent";
import { LinearThenvoiExampleRestApi } from "../examples/linear-thenvoi-rest-stub";

describe("linear thenvoi examples", () => {
  it("builds a bridge app without import-time side effects", () => {
    const app = createLinearThenvoiBridgeApp({
      restApi: new LinearThenvoiExampleRestApi(),
      linearAccessToken: "lin_api_test",
      linearWebhookSecret: "linear_webhook_secret",
      stateDbPath: ":memory:",
      hostAgentHandle: "linear-host",
      roomStrategy: "issue",
    });

    expect(app).toBeDefined();
    expect(typeof app.listen).toBe("function");
  });

  it("builds a Thenvoi-hosted orchestrator agent", () => {
    const agent = createLinearThenvoiOrchestratorAgent({
      linearAccessToken: "lin_api_test",
      restApi: new LinearThenvoiExampleRestApi(),
    });

    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe("function");
    expect(typeof agent.stop).toBe("function");
  });
});
