import { describe, expect, it } from "vitest";

import { createBasicAgent } from "../examples/basic/basic-agent";
import { StubRestApi } from "../src/testing";

describe("basic-agent example", () => {
  it("builds an agent instance without side effects on import", () => {
    const agent = createBasicAgent();
    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe("function");
    expect(typeof agent.stop).toBe("function");
  });

  it("StubRestApi returns sensible defaults", async () => {
    const rest = new StubRestApi();
    await expect(rest.getAgentMe()).resolves.toMatchObject({
      id: "stub-agent",
      name: "Stub Agent",
    });
  });
});
