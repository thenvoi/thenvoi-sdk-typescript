import { afterEach, describe, expect, it } from "vitest";

import { createThenvoiMcpBackend } from "../src/mcp/backends";
import { FakeTools } from "./testUtils";

describe("createThenvoiMcpBackend", () => {
  const backends: Array<{ stop(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(backends.map(async (backend) => {
      await backend.stop();
    }));
    backends.length = 0;
  });

  it("creates an sdk backend with allowed tools", async () => {
    const backend = await createThenvoiMcpBackend({
      kind: "sdk",
      enableMemoryTools: false,
      getToolsForRoom: () => new FakeTools(),
    });
    backends.push(backend);

    expect(backend.kind).toBe("sdk");
    expect(backend.allowedTools).toContain("mcp__thenvoi__thenvoi_send_message");
  });

  it("creates an http backend and starts the local server", async () => {
    const backend = await createThenvoiMcpBackend({
      kind: "http",
      enableMemoryTools: false,
      getToolsForRoom: () => new FakeTools(),
    });
    backends.push(backend);

    expect(backend.kind).toBe("http");
    expect(backend.allowedTools).toContain("mcp__thenvoi__thenvoi_send_message");
    expect(backend.server).toHaveProperty("url");
  });

  it("creates an sse backend and starts the local server", async () => {
    const backend = await createThenvoiMcpBackend({
      kind: "sse",
      enableMemoryTools: false,
      getToolsForRoom: () => new FakeTools(),
    });
    backends.push(backend);

    expect(backend.kind).toBe("sse");
    expect(backend.allowedTools).toContain("mcp__thenvoi__thenvoi_send_message");
    expect(backend.server).toHaveProperty("sseUrl");
  });
});
