import { describe, expect, it } from "vitest";

import { Agent } from "../src/agent/Agent";
import { GenericAdapter } from "../src/adapters/GenericAdapter";

describe("Agent.create", () => {
  it("accepts a typed config object without spreading credentials", () => {
    const agent = Agent.create({
      adapter: new GenericAdapter(async () => undefined),
      config: {
        agentId: "agent-from-config",
        apiKey: "key-from-config",
      },
    });

    expect(agent.runtime.agentId).toBe("agent-from-config");
  });

  it("lets explicit credentials override config values", () => {
    const agent = Agent.create({
      adapter: new GenericAdapter(async () => undefined),
      config: {
        agentId: "agent-from-config",
        apiKey: "key-from-config",
      },
      agentId: "agent-override",
      apiKey: "key-override",
    });

    expect(agent.runtime.agentId).toBe("agent-override");
  });
});
