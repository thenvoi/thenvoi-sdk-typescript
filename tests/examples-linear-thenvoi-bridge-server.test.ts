import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createLinearClientMock = vi.fn();
const createLinearWebhookHandlerMock = vi.fn();
const createSqliteSessionRoomStoreMock = vi.fn();
const handleAgentSessionEventMock = vi.fn();
const loadAgentConfigMock = vi.fn();

vi.mock("../src/index", () => ({
  Agent: class {},
  loadAgentConfig: loadAgentConfigMock,
  isDirectExecution: vi.fn(() => false),
}));

vi.mock("../src/linear", async () => {
  const actual = await vi.importActual<typeof import("../src/linear")>("../src/linear");
  return {
    ...actual,
    createLinearClient: createLinearClientMock,
    createLinearWebhookHandler: createLinearWebhookHandlerMock,
    createSqliteSessionRoomStore: createSqliteSessionRoomStoreMock,
    handleAgentSessionEvent: handleAgentSessionEventMock,
  };
});

type HeadersLike = { get(name: string): string | null };
const servers = new Set<Server>();

function makeHeaders(values: Record<string, string>): HeadersLike {
  return {
    get(name: string): string | null {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

async function startAppServer(
  app: Parameters<typeof createServer>[0],
): Promise<string> {
  const server = createServer(app);
  servers.add(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  return `http://127.0.0.1:${address.port}`;
}

describe("linear thenvoi bridge server example", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
    delete process.env.THENVOI_API_KEY;
    delete process.env.LINEAR_THENVOI_BRIDGE_AGENT_CONFIG_KEY;
    delete process.env.LINEAR_THENVOI_BRIDGE_RUNTIME_CONFIG_KEY;
    delete process.env.LINEAR_THENVOI_DISPATCH_RETRY_LIMIT;
    delete process.env.LINEAR_THENVOI_DISPATCH_RETRY_BASE_DELAY_MS;
    delete process.env.LINEAR_THENVOI_ROOM_RESET_TIMEOUT_MS;

    createLinearClientMock.mockReturnValue({ kind: "linear-client" });
    createSqliteSessionRoomStoreMock.mockReturnValue({ kind: "store" });
    createLinearWebhookHandlerMock.mockReturnValue(async (_request, response) => {
      response.status(204).send("ok");
    });
  });

  afterEach(() => {
    void Promise.all([...servers].map((server) => new Promise<void>((resolve) => {
      server.close(() => resolve());
    })));
    servers.clear();
    delete process.env.THENVOI_API_KEY;
    delete process.env.LINEAR_THENVOI_BRIDGE_AGENT_CONFIG_KEY;
    delete process.env.LINEAR_THENVOI_BRIDGE_RUNTIME_CONFIG_KEY;
    delete process.env.LINEAR_THENVOI_DISPATCH_RETRY_LIMIT;
    delete process.env.LINEAR_THENVOI_DISPATCH_RETRY_BASE_DELAY_MS;
    delete process.env.LINEAR_THENVOI_ROOM_RESET_TIMEOUT_MS;
  });

  it("wires the app with the webhook handler, store, and health endpoint", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const webhookHandler = vi.fn(async (_request, response) => {
      response.status(202).send("queued");
    });
    createLinearWebhookHandlerMock.mockReturnValue(webhookHandler);

    const module = await import("../examples/linear-thenvoi/linear-thenvoi-bridge-server");
    const app = module.createLinearThenvoiBridgeApp({
      restApi: { getAgentMe: vi.fn() } as never,
      linearAccessToken: "lin_api_test",
      linearWebhookSecret: "secret",
      stateDbPath: ".bridge.sqlite",
      hostAgentHandle: "linear-host",
      roomStrategy: "issue",
      writebackMode: "final_only",
      logger: logger as never,
    });
    const baseUrl = await startAppServer(app);

    expect(createSqliteSessionRoomStoreMock).toHaveBeenCalledWith(".bridge.sqlite");
    expect(createLinearClientMock).toHaveBeenCalledWith("lin_api_test");
    expect(createLinearWebhookHandlerMock).toHaveBeenCalledWith({
      config: {
        linearAccessToken: "lin_api_test",
        linearWebhookSecret: "secret",
        hostAgentHandle: "linear-host",
        roomStrategy: "issue",
        writebackMode: "final_only",
      },
      dispatcher: undefined,
      deps: {
        thenvoiRest: { getAgentMe: expect.any(Function) },
        linearClient: { kind: "linear-client" },
        store: { kind: "store" },
        logger,
      },
    });
    expect(app.locals.sessionRoomStore).toEqual({ kind: "store" });

    const healthResponse = await fetch(`${baseUrl}/healthz`);

    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toEqual({ ok: true });

    const webhookResponse = await fetch(`${baseUrl}/linear/webhook`, {
      method: "POST",
      body: "payload",
      headers: { "content-type": "application/json" },
    });

    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.text()).resolves.toBe("queued");
    expect(webhookHandler).toHaveBeenCalledOnce();
  });

  it("returns a 500 response when the webhook handler throws", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    createLinearWebhookHandlerMock.mockReturnValue(async () => {
      throw new Error("boom");
    });

    const module = await import("../examples/linear-thenvoi/linear-thenvoi-bridge-server");
    const app = module.createLinearThenvoiBridgeApp({
      restApi: { getAgentMe: vi.fn() } as never,
      linearAccessToken: "lin_api_test",
      linearWebhookSecret: "secret",
      stateDbPath: ".bridge.sqlite",
      logger: logger as never,
    });
    const baseUrl = await startAppServer(app);

    const response = await fetch(`${baseUrl}/linear/webhook`, {
      method: "POST",
      body: "payload",
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "webhook_error" });
    expect(logger.error).toHaveBeenCalledWith("linear_thenvoi_bridge.webhook_error", {
      error: "boom",
    });
  });

  it("prefers the embedded runtime key in embedded mode and falls back with a warning when missing", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    process.env.THENVOI_API_KEY = "thnv_fallback";

    const module = await import("../examples/linear-thenvoi/linear-thenvoi-bridge-server");

    expect(module.resolveRestApiKeyForMode({
      logger: logger as never,
      embedBridgeAgent: true,
      embeddedBridgeConfig: { apiKey: "thnv_runtime" } as never,
    })).toBe("thnv_runtime");

    expect(module.resolveRestApiKeyForMode({
      logger: logger as never,
      embedBridgeAgent: true,
      embeddedBridgeConfig: null,
    })).toBe("thnv_fallback");
    expect(logger.warn).toHaveBeenCalledWith(
      "linear_thenvoi_bridge.embedded_mode_missing_runtime_api_key",
      expect.objectContaining({
        runtimeConfigKey: "linear_thenvoi_bridge",
      }),
    );
  });

  it("rate limits requests and retries 429 responses using retry-after", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const calls: string[] = [];
    let createMessageAttempts = 0;
    const restApi = {
      async getAgentMe() {
        calls.push("getAgentMe");
        return { id: "agent-1", name: "Agent", description: null };
      },
      async createChatMessage() {
        createMessageAttempts += 1;
        calls.push(`createChatMessage:${createMessageAttempts}`);
        if (createMessageAttempts === 1) {
          const error = new Error("POST /api/v1/agent/chats/chat-1/messages failed (429)");
          Object.assign(error, {
            rawResponse: {
              headers: makeHeaders({ "retry-after": "0" }),
            },
          });
          throw error;
        }
        return { ok: true };
      },
    };

    const module = await import("../examples/linear-thenvoi/linear-thenvoi-bridge-server");
    const wrapped = module.createRateLimitedRestApi({
      api: restApi as never,
      minIntervalMs: 0,
      retryLimit: 2,
      retryBaseDelayMs: 0,
      logger: logger as never,
    });

    await wrapped.getAgentMe?.();
    await wrapped.createChatMessage?.("chat-1", { content: "hello" });

    expect(calls).toEqual(["getAgentMe", "createChatMessage:1", "createChatMessage:2"]);
    expect(logger.warn).toHaveBeenCalledWith(
      "linear_thenvoi_bridge.rest_rate_limited_retrying",
      expect.objectContaining({
        operation: "createChatMessage",
        attempt: 1,
        maxAttempts: 3,
      }),
    );
  });

  it("retries embedded agent startup for timeout and 429 failures, then succeeds", async () => {
    vi.useFakeTimers();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const agent = {
      start: vi.fn()
        .mockRejectedValueOnce(new Error("Timed out waiting for Phoenix socket connection"))
        .mockRejectedValueOnce(new Error("startup failed (429)"))
        .mockResolvedValueOnce(undefined),
    };

    const module = await import("../examples/linear-thenvoi/linear-thenvoi-bridge-server");
    const startPromise = module.startEmbeddedAgentWithRetry(agent as never, logger as never);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(4_000);
    await startPromise;

    expect(agent.start).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledWith(
      "linear_thenvoi_bridge.embedded_agent_start_retrying",
      expect.objectContaining({ attempt: 1 }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "linear_thenvoi_bridge.embedded_agent_start_retrying",
      expect.objectContaining({ attempt: 2 }),
    );
  });

  it("resets queued room sessions, deduplicates duplicate event keys, and marks processed on success", async () => {
    handleAgentSessionEventMock.mockResolvedValue(undefined);
    const store = {
      listPendingBootstrapRequests: vi.fn(async () => [
        {
          eventKey: "event-1",
          thenvoiRoomId: "room-1",
          expectedContent: "make a plan",
          messageType: "task",
          metadata: { linear_reset_room_session: true },
          createdAt: "2026-03-02T00:00:00.000Z",
          linearSessionId: "session-1",
        },
      ]),
      markBootstrapRequestProcessed: vi.fn(async () => undefined),
    };
    const agent = {
      resetRoomSession: vi.fn(async () => true),
      bootstrapRoomMessage: vi.fn(async () => undefined),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const module = await import("../examples/linear-thenvoi/linear-thenvoi-bridge-server");
    const dispatcher = module.createEmbeddedLinearBridgeDispatcher({
      agent: agent as never,
      store: store as never,
      ensureAgentStarted: vi.fn(async () => undefined),
      logger: logger as never,
    });

    const job = {
      eventKey: "event-1",
      input: {
        payload: {
          agentSession: {
            id: "session-1",
          },
        },
      },
    };

    dispatcher.dispatch(job as never);
    dispatcher.dispatch(job as never);

    await vi.waitFor(() => {
      expect(store.markBootstrapRequestProcessed).toHaveBeenCalledWith("event-1");
    });

    expect(handleAgentSessionEventMock).toHaveBeenCalledTimes(1);
    expect(agent.resetRoomSession).toHaveBeenCalledWith("room-1", 5000);
    expect(agent.bootstrapRoomMessage).toHaveBeenCalledWith(
      "room-1",
      expect.objectContaining({
        id: "linear-bootstrap:event-1",
        roomId: "room-1",
        senderId: "linear-session:session-1",
      }),
    );
    expect(dispatcher.isQueued("event-1")).toBe(false);
  });

  it("does not mark bootstrap requests processed when dispatch keeps failing", async () => {
    process.env.LINEAR_THENVOI_DISPATCH_RETRY_LIMIT = "0";
    handleAgentSessionEventMock.mockResolvedValue(undefined);
    const store = {
      listPendingBootstrapRequests: vi.fn(async () => [
        {
          eventKey: "event-2",
          thenvoiRoomId: "room-2",
          expectedContent: "make a plan",
          messageType: "task",
          metadata: {},
          createdAt: "2026-03-02T00:00:00.000Z",
          linearSessionId: "session-2",
        },
      ]),
      markBootstrapRequestProcessed: vi.fn(async () => undefined),
    };
    const agent = {
      resetRoomSession: vi.fn(async () => true),
      bootstrapRoomMessage: vi.fn(async () => {
        throw new Error("POST /api/v1/agent/chats/room-2/events failed (429)");
      }),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const module = await import("../examples/linear-thenvoi/linear-thenvoi-bridge-server");
    const dispatcher = module.createEmbeddedLinearBridgeDispatcher({
      agent: agent as never,
      store: store as never,
      logger: logger as never,
    });

    dispatcher.dispatch({
      eventKey: "event-2",
      input: {
        payload: {
          agentSession: {
            id: "session-2",
          },
        },
      },
    } as never);

    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        "linear_thenvoi_bridge.embedded_dispatch_failed",
        expect.objectContaining({
          eventKey: "event-2",
          sessionId: "session-2",
          error: expect.objectContaining({
            retryable: true,
          }),
        }),
      );
    });

    expect(store.markBootstrapRequestProcessed).not.toHaveBeenCalled();
    expect(dispatcher.isQueued("event-2")).toBe(false);
  });

  it("signs and forwards bridge webhook requests through the real express app", async () => {
    createLinearWebhookHandlerMock.mockImplementation(({ config, dispatcher, deps }) => {
      return async (request, response) => {
        expect(config.linearWebhookSecret).toBe("secret");
        expect(dispatcher).toEqual({ kind: "dispatcher" });
        expect(deps.store).toEqual({ kind: "provided-store" });
        response.status(201).json({ ok: true });
      };
    });

    const module = await import("../examples/linear-thenvoi/linear-thenvoi-bridge-server");
    const app = module.createLinearThenvoiBridgeApp({
      restApi: { getAgentMe: vi.fn() } as never,
      linearAccessToken: "lin_api_test",
      linearWebhookSecret: "secret",
      stateDbPath: ".ignored.sqlite",
      store: { kind: "provided-store" } as never,
      dispatcher: { kind: "dispatcher" } as never,
    });
    const baseUrl = await startAppServer(app);

    const payload = JSON.stringify({ hello: "world" });
    const timestamp = String(Date.now());
    const signature = createHmac("sha256", "secret").update(payload).digest("hex");

    const response = await fetch(`${baseUrl}/linear/webhook`, {
      method: "POST",
      body: payload,
      headers: {
        "content-type": "application/json",
        "linear-timestamp": timestamp,
        "linear-signature": signature,
      },
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
