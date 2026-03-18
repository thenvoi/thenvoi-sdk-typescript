import { describe, expect, it } from "vitest";

import { createCustomAdapterAgent } from "../examples/custom-adapter/custom-adapter";

describe("examples/custom-adapter", () => {
  it("creates an import-safe custom adapter agent", () => {
    const agent = createCustomAdapterAgent({
      agentId: "agent-custom",
    });

    expect(agent.runtime.agentId).toBe("agent-custom");
    expect(agent.isRunning).toBe(false);
  });
});
