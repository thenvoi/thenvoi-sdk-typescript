import { describe, expect, it, afterEach } from "vitest";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadAgentConfig } from "../src/config/loader";

function tmpFile(content: string): string {
  const dir = join(tmpdir(), `thenvoi-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "agent_config.yaml");
  writeFileSync(path, content, "utf-8");
  return path;
}

const cleanup: string[] = [];

afterEach(() => {
  for (const path of cleanup) {
    try {
      unlinkSync(path);
    } catch {
      // ignore
    }
  }
  cleanup.length = 0;
});

describe("loadAgentConfig", () => {
  it("loads keyed format", () => {
    const path = tmpFile(`
my_agent:
  agent_id: "agent-123"
  api_key: "key-456"
  ws_url: "wss://example.com"
`);
    cleanup.push(path);

    const result = loadAgentConfig("my_agent", path);
    expect(result.agentId).toBe("agent-123");
    expect(result.apiKey).toBe("key-456");
    expect(result.wsUrl).toBe("wss://example.com");
  });

  it("loads flat format", () => {
    const path = tmpFile(`
agent_id: "agent-flat"
api_key: "key-flat"
`);
    cleanup.push(path);

    const result = loadAgentConfig(undefined, path);
    expect(result.agentId).toBe("agent-flat");
    expect(result.apiKey).toBe("key-flat");
  });

  it("falls back to flat format when key not found", () => {
    const path = tmpFile(`
agent_id: "agent-fallback"
api_key: "key-fallback"
`);
    cleanup.push(path);

    const result = loadAgentConfig("nonexistent_key", path);
    expect(result.agentId).toBe("agent-fallback");
    expect(result.apiKey).toBe("key-fallback");
  });

  it("throws for missing file", () => {
    expect(() => loadAgentConfig(undefined, "/nonexistent/path.yaml")).toThrow(
      "Config file not found",
    );
  });

  it("error message mentions agent_config.yaml.example", () => {
    expect(() => loadAgentConfig(undefined, "/nonexistent/path.yaml")).toThrow(
      "agent_config.yaml.example",
    );
  });

  it("throws for missing required fields", () => {
    const path = tmpFile(`
agent_id: "agent-123"
`);
    cleanup.push(path);

    expect(() => loadAgentConfig(undefined, path)).toThrow("Missing required fields");
    expect(() => loadAgentConfig(undefined, path)).toThrow("api_key");
  });

  it("normalizes camelCase keys to snake_case and maps wsUrl/restUrl", () => {
    const path = tmpFile(`
agentId: "agent-camel"
apiKey: "key-camel"
wsUrl: "wss://example.com"
restUrl: "https://example.com"
`);
    cleanup.push(path);

    const result = loadAgentConfig(undefined, path);
    expect(result.agentId).toBe("agent-camel");
    expect(result.apiKey).toBe("key-camel");
    expect(result.wsUrl).toBe("wss://example.com");
    expect(result.restUrl).toBe("https://example.com");
  });

  it("maps ws_url and rest_url to camelCase wsUrl and restUrl", () => {
    const path = tmpFile(`
agent_id: "agent-snake"
api_key: "key-snake"
ws_url: "wss://ws.example.com"
rest_url: "https://rest.example.com"
`);
    cleanup.push(path);

    const result = loadAgentConfig(undefined, path);
    expect(result.wsUrl).toBe("wss://ws.example.com");
    expect(result.restUrl).toBe("https://rest.example.com");
  });

  it("omits wsUrl/restUrl when not present in config", () => {
    const path = tmpFile(`
agent_id: "agent-minimal"
api_key: "key-minimal"
`);
    cleanup.push(path);

    const result = loadAgentConfig(undefined, path);
    expect(result.wsUrl).toBeUndefined();
    expect(result.restUrl).toBeUndefined();
  });

  it("result can be spread into Agent.create options", () => {
    const path = tmpFile(`
agent_id: "agent-spread"
api_key: "key-spread"
ws_url: "wss://example.com"
`);
    cleanup.push(path);

    const result = loadAgentConfig(undefined, path);
    const options = { adapter: {} as never, ...result };
    expect(options.agentId).toBe("agent-spread");
    expect(options.apiKey).toBe("key-spread");
    expect(options.wsUrl).toBe("wss://example.com");
  });

  it("throws for non-string agent_id", () => {
    const path = tmpFile(`
agent_id: 123
api_key: "key"
`);
    cleanup.push(path);

    expect(() => loadAgentConfig(undefined, path)).toThrow("must be non-empty strings");
  });

  it("throws for empty string values", () => {
    const path = tmpFile(`
agent_id: ""
api_key: "key"
`);
    cleanup.push(path);

    expect(() => loadAgentConfig(undefined, path)).toThrow("Missing required fields");
  });

  it("throws for whitespace-only string values", () => {
    const path = tmpFile(`
agent_id: "  "
api_key: "key"
`);
    cleanup.push(path);

    expect(() => loadAgentConfig(undefined, path)).toThrow("must be non-empty strings");
  });
});
