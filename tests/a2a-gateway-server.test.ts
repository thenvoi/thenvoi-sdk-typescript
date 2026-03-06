import type { Server as HttpServer } from "node:http";

import { describe, expect, it } from "vitest";

import { createGatewayServer } from "../src/adapters/a2a-gateway/server";
import type { GatewayServerOptions } from "../src/adapters/a2a-gateway/types";

interface RecordedUse {
  args: unknown[];
}

interface AuthResponse {
  status: (code: number) => AuthResponse;
  json: (payload: unknown) => void;
  setHeader: () => void;
}

function makeServerOptions(
  overrides: Partial<GatewayServerOptions> = {},
): GatewayServerOptions {
  return {
    peersBySlug: new Map([
      ["weather", {
        id: "peer-1",
        slug: "weather",
        name: "Weather",
        description: "Weather agent",
      }],
    ]),
    peersById: new Map(),
    gatewayUrl: "http://localhost:10000",
    host: "127.0.0.1",
    port: 10_000,
    onRequest: async function* () {
      yield {
        kind: "status-update",
        taskId: "task-1",
        contextId: "ctx-1",
        final: true,
        status: {
          state: "completed",
        },
      };
    },
    ...overrides,
  };
}

function createModulesRecorder() {
  const recordedUses: RecordedUse[] = [];
  const fakeServer = {
    once: () => fakeServer,
    close: (callback?: (error?: Error) => void) => callback?.(),
  } as unknown as HttpServer;

  const fakeApp = {
    use: (...args: unknown[]) => {
      recordedUses.push({ args });
    },
    get: (..._args: unknown[]) => undefined,
    listen: (_port: number, _host: string, callback?: () => void) => {
      callback?.();
      return fakeServer;
    },
  };

  const createExpressApp = Object.assign(
    () => fakeApp,
    {
      json: () => "json-middleware",
    },
  );

  const modules = {
    AGENT_CARD_PATH: ".well-known/agent-card.json",
    DefaultRequestHandler: class {
      public async getAgentCard(): Promise<Record<string, unknown>> {
        return { ok: true };
      }
    },
    InMemoryTaskStore: class {},
    UserBuilder: {
      noAuthentication: async () => ({ id: "anon" }),
    },
    agentCardHandler: () => "agent-card-handler",
    jsonRpcHandler: () => "jsonrpc-handler",
    restHandler: () => "rest-handler",
    createExpressApp,
  };

  return {
    recordedUses,
    loadModules: async () => modules,
  };
}

describe("GatewayServer", () => {
  it("requires auth when binding to a non-loopback host", async () => {
    const { loadModules } = createModulesRecorder();
    const server = createGatewayServer(makeServerOptions({
      host: "0.0.0.0",
      loadModules,
    }));

    await expect(server.start()).rejects.toThrow(
      "A2A gateway authToken is required when binding to a non-loopback host.",
    );
  });

  it("applies security headers and bearer auth middleware when configured", async () => {
    const { recordedUses, loadModules } = createModulesRecorder();
    const server = createGatewayServer(makeServerOptions({
      authToken: "secret-token",
      loadModules,
    }));

    await server.start();
    await server.stop();

    const securityHeadersMiddleware = recordedUses[0]?.args[0];
    expect(typeof securityHeadersMiddleware).toBe("function");

    const headerValues = new Map<string, string>();
    let securityNextCalled = false;
    (securityHeadersMiddleware as (
      request: unknown,
      response: { setHeader: (name: string, value: string) => void },
      next: () => void,
    ) => void)(
      {},
      {
        setHeader: (name, value) => {
          headerValues.set(name, value);
        },
      },
      () => {
        securityNextCalled = true;
      },
    );

    expect(securityNextCalled).toBe(true);
    expect(headerValues.get("X-Frame-Options")).toBe("DENY");
    expect(headerValues.get("X-Content-Type-Options")).toBe("nosniff");

    const peersAuthMiddleware = recordedUses.find((entry) => entry.args[0] === "/peers")?.args[1];
    expect(typeof peersAuthMiddleware).toBe("function");

    let nextCalled = false;
    let statusCode = 200;
    let body: unknown = null;
    const response: AuthResponse = {
      status: (code: number) => {
        statusCode = code;
        return response;
      },
      json: (payload: unknown) => {
        body = payload;
      },
      setHeader: () => undefined,
    };

    (peersAuthMiddleware as (
      request: { headers?: Record<string, string> },
      response: AuthResponse,
      next: () => void,
    ) => void)({}, response, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });

    (peersAuthMiddleware as (
      request: { headers?: Record<string, string> },
      response: AuthResponse,
      next: () => void,
    ) => void)({
      headers: {
        authorization: "Bearer secret-token",
      },
    }, response, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
  });
});
