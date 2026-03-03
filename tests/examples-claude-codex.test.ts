import { describe, expect, it } from "vitest";

import { createClaudeSdkAgent } from "../examples/claude-sdk-agent";
import { createCodexAgent } from "../examples/codex-agent";

describe("claude/codex examples", () => {
  it("builds a Claude SDK adapter agent without import-time side effects", () => {
    const agent = createClaudeSdkAgent();
    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe("function");
    expect(typeof agent.stop).toBe("function");
  });

  it("builds a Codex adapter agent without import-time side effects", () => {
    const agent = createCodexAgent();
    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe("function");
    expect(typeof agent.stop).toBe("function");
  });
});
