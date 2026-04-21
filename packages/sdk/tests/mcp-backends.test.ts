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

  it("creates a single-room sdk backend without requiring room-scoped execution", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const tools = new FakeTools();
    tools.executeToolCall = async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { ok: true };
    };

    const backend = await createThenvoiMcpBackend({
      kind: "sdk",
      multiRoom: false,
      enableMemoryTools: false,
      getToolsForRoom: () => tools,
    });
    backends.push(backend);

    expect(backend.kind).toBe("sdk");
    expect(backend.allowedTools).toContain("mcp__thenvoi__thenvoi_send_message");

    const toolDefinitions = (backend.server as { toolDefinitions: Array<{ name: string; handler: (args: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<{ isError?: true }> }> }).toolDefinitions;
    const sendMessage = toolDefinitions.find((tool) => tool.name === "thenvoi_send_message");
    expect(sendMessage).toBeDefined();
    if (!sendMessage) {
      throw new Error("thenvoi_send_message tool definition missing");
    }

    const result = await sendMessage.handler({ content: "hello" }, {});
    expect(result.isError).toBeUndefined();
    expect(calls).toEqual([
      {
        name: "thenvoi_send_message",
        args: { content: "hello" },
      },
    ]);
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
