import { describe, expect, it } from "vitest";

import { createBasicAgent, StubRestApi } from "../examples/basic-agent";

describe("basic-agent example", () => {
  it("builds an agent instance without side effects on import", () => {
    const agent = createBasicAgent();
    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe("function");
    expect(typeof agent.stop).toBe("function");
  });

  it("provides a rest stub for local example execution", async () => {
    const rest = new StubRestApi();
    await expect(rest.getAgentMe()).resolves.toMatchObject({
      id: "agent-1",
      name: "Example Agent",
    });
  });
});
