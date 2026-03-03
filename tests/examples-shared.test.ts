import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { GenericAdapter } from "../src/index";
import {
  ExampleRestApi,
  createExampleAgent,
  isDirectExecution,
  requireA2ARemoteUrl,
} from "../examples/shared";

const ORIGINAL_ARGV = [...process.argv];
const ORIGINAL_A2A_AGENT_URL = process.env.A2A_AGENT_URL;

afterEach(() => {
  process.argv = [...ORIGINAL_ARGV];
  if (ORIGINAL_A2A_AGENT_URL === undefined) {
    delete process.env.A2A_AGENT_URL;
  } else {
    process.env.A2A_AGENT_URL = ORIGINAL_A2A_AGENT_URL;
  }
});

describe("examples/shared", () => {
  it("builds a configured example agent", () => {
    const restApi = new ExampleRestApi({
      id: "agent-123",
      name: "Demo Agent",
      description: "demo",
    });
    const adapter = new GenericAdapter(async () => {});

    const agent = createExampleAgent({
      adapter,
      agentId: "agent-123",
      restApi,
      apiKey: "secret",
    });

    expect(agent.runtime.agentId).toBe("agent-123");
  });

  it("detects direct execution from process entrypoint", () => {
    process.argv[1] = "/tmp/demo-entry.ts";
    const matchingMetaUrl = pathToFileURL("/tmp/demo-entry.ts").href;
    const differentMetaUrl = pathToFileURL("/tmp/other-entry.ts").href;

    expect(isDirectExecution(matchingMetaUrl)).toBe(true);
    expect(isDirectExecution(differentMetaUrl)).toBe(false);
  });

  it("returns false for direct execution when no process entry exists", () => {
    process.argv = [];
    expect(isDirectExecution("file:///tmp/demo-entry.ts")).toBe(false);
  });

  it("requires a remote URL from options or environment", () => {
    delete process.env.A2A_AGENT_URL;
    expect(requireA2ARemoteUrl("https://example.com/a2a")).toBe("https://example.com/a2a");

    process.env.A2A_AGENT_URL = "https://env.example.com/a2a";
    expect(requireA2ARemoteUrl()).toBe("https://env.example.com/a2a");

    delete process.env.A2A_AGENT_URL;
    expect(() => requireA2ARemoteUrl()).toThrow("A2A remote URL is required");
  });

  it("provides a minimal rest API stub", async () => {
    const rest = new ExampleRestApi({
      id: "agent-42",
      name: "Example Agent",
      description: "description",
    });

    await expect(rest.getAgentMe()).resolves.toEqual({
      id: "agent-42",
      name: "Example Agent",
      description: "description",
    });
    await expect(rest.listPeers()).resolves.toEqual({ data: [] });
  });
});
