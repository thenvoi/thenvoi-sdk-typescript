import { describe, expect, it } from "vitest";

import { createCustomAdapterAgent } from "../examples/custom-adapter";
import { ExampleRestApi } from "../examples/shared";

describe("examples/custom-adapter", () => {
  it("creates an import-safe custom adapter agent", () => {
    const agent = createCustomAdapterAgent({
      agentId: "agent-custom",
      restApi: new ExampleRestApi({
        id: "agent-custom",
        name: "Custom Agent",
        description: "custom example",
      }),
    });

    expect(agent.runtime.agentId).toBe("agent-custom");
    expect(agent.isRunning).toBe(false);
  });
});
