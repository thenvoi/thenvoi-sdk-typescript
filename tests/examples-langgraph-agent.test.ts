import { describe, expect, it } from "vitest";

import { createLangGraphAgent, EchoLangGraph } from "../examples/langgraph-agent";

describe("langgraph-agent example", () => {
  it("builds a LangGraph-based agent without side effects on import", () => {
    const agent = createLangGraphAgent();
    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe("function");
    expect(typeof agent.stop).toBe("function");
  });

  it("provides a minimal local graph implementation", async () => {
    const graph = new EchoLangGraph();
    const result = (await graph.invoke({
      messages: [["user", "hello"]],
    })) as {
      messages: Array<[string, string]>;
    };

    expect(result.messages[0]?.[0]).toBe("assistant");
    expect(result.messages[0]?.[1]).toContain("Echo from LangGraph");
  });
});
