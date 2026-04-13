import { createHmac } from "node:crypto";
import { createServer } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createInProcessLinearBridgeDispatcher,
  createLinearWebhookHandler,
  type LinearBridgeDispatcher,
  type LinearThenvoiBridgeConfig,
  type PendingBootstrapRequest,
  type SessionRoomRecord,
  type SessionRoomStore,
} from "../src/linear";
import { LinearThenvoiExampleRestApi } from "../examples/linear-thenvoi/linear-thenvoi-rest-stub";

class MemorySessionRoomStore implements SessionRoomStore {
  private readonly records = new Map<string, SessionRoomRecord>();
  private readonly bootstrapRequests = new Map<string, PendingBootstrapRequest>();

  public async getBySessionId(sessionId: string): Promise<SessionRoomRecord | null> {
    return this.records.get(sessionId) ?? null;
  }

  public async getByIssueId(issueId: string): Promise<SessionRoomRecord | null> {
    return [...this.records.values()].find((record) => record.linearIssueId === issueId) ?? null;
  }

  public async upsert(record: SessionRoomRecord): Promise<void> {
    this.records.set(record.linearSessionId, record);
  }

  public async markCanceled(sessionId: string): Promise<void> {
    const existing = this.records.get(sessionId);
    if (!existing) {
      return;
    }

    this.records.set(sessionId, {
      ...existing,
      status: "canceled",
      updatedAt: new Date().toISOString(),
    });
  }

  public async enqueueBootstrapRequest(request: PendingBootstrapRequest): Promise<void> {
    this.bootstrapRequests.set(request.eventKey, request);
  }

  public async listPendingBootstrapRequests(): Promise<PendingBootstrapRequest[]> {
    return [...this.bootstrapRequests.values()];
  }

  public async markBootstrapRequestProcessed(eventKey: string): Promise<void> {
    this.bootstrapRequests.delete(eventKey);
  }
}

const servers = new Set<ReturnType<typeof createServer>>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
  servers.clear();
});

const config: LinearThenvoiBridgeConfig = {
  linearAccessToken: "lin_api_test",
  linearWebhookSecret: "linear_webhook_secret",
  hostAgentHandle: "linear-host",
  roomStrategy: "issue",
  writebackMode: "activity_stream",
};

function makePayload() {
  return {
    action: "created",
    type: "AgentSessionEvent",
    appUserId: "app-user",
    createdAt: new Date(),
    oauthClientId: "oauth-client",
    organizationId: "org-1",
    webhookId: "webhook-1",
    webhookTimestamp: Date.now(),
    promptContext: "@research-agent investigate and summarize",
    agentSession: {
      id: "session-1",
      issueId: "issue-1",
      status: "active",
      type: "issue",
      appUserId: "app-user",
      createdAt: new Date().toISOString(),
      organizationId: "org-1",
      updatedAt: new Date().toISOString(),
      issue: {
        id: "issue-1",
        title: "Investigate bug",
        identifier: "INT-1",
        team: {
          id: "team-1",
          key: "INT",
          name: "Integrations",
        },
        teamId: "team-1",
        url: "https://linear.app/example/issue/INT-1",
      },
    },
  };
}

function sign(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

async function startServer(dispatcher?: LinearBridgeDispatcher) {
  const store = new MemorySessionRoomStore();
  const linearClient = {
    createAgentActivity: vi.fn(async () => ({ ok: true })),
    agentSessionUpdateExternalUrl: vi.fn(async () => ({ success: true })),
  };
  const handler = createLinearWebhookHandler({
    config,
    dispatcher,
    deps: {
      thenvoiRest: new LinearThenvoiExampleRestApi(),
      linearClient: linearClient as never,
      store,
    },
  });

  const server = createServer((request, response) => {
    void handler(request, response);
  });
  servers.add(server);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  return {
    linearClient,
    store,
    url: `http://127.0.0.1:${address.port}/linear/webhook`,
  };
}

describe("createLinearWebhookHandler", () => {
  it("verifies the payload, posts acknowledgment, and dispatches async work", async () => {
    const queued = new Set<string>();
    const dispatcher = {
      isQueued: (eventKey: string) => queued.has(eventKey),
      dispatch: vi.fn((job) => {
        queued.add(job.eventKey);
      }),
    } satisfies LinearBridgeDispatcher;

    const { linearClient, url } = await startServer(dispatcher);
    const payload = makePayload();
    const rawBody = JSON.stringify(payload);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": sign(config.linearWebhookSecret, rawBody),
        "linear-timestamp": String(payload.webhookTimestamp),
      },
      body: rawBody,
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("OK");
    expect(linearClient.createAgentActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionId: "session-1",
        content: expect.objectContaining({
          type: "thought",
          body: "Received session. Setting up workspace...",
        }),
      }),
    );
    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
  });

  it("rejects invalid signatures", async () => {
    const { url } = await startServer();
    const payload = makePayload();
    const rawBody = JSON.stringify(payload);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": "invalid",
        "linear-timestamp": String(payload.webhookTimestamp),
      },
      body: rawBody,
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Invalid webhook");
  });

  it("rejects requests missing timestamp headers", async () => {
    const { url } = await startServer();
    const payload = makePayload();
    const rawBody = JSON.stringify(payload);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": sign(config.linearWebhookSecret, rawBody),
      },
      body: rawBody,
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Missing webhook timestamp");
  });

  it("marks bootstrap handoff processed after inline dispatch", async () => {
    const { store, url } = await startServer();
    const payload = makePayload();
    const rawBody = JSON.stringify(payload);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": sign(config.linearWebhookSecret, rawBody),
        "linear-timestamp": String(payload.webhookTimestamp),
      },
      body: rawBody,
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("OK");
    await expect(store.listPendingBootstrapRequests()).resolves.toEqual([]);
  });

  it("skips events that are already queued", async () => {
    const queued = new Set<string>();
    const dispatcher = {
      isQueued: (eventKey: string) => queued.has(eventKey),
      dispatch: vi.fn((job) => {
        queued.add(job.eventKey);
      }),
    } satisfies LinearBridgeDispatcher;

    const { linearClient, url } = await startServer(dispatcher);
    const payload = makePayload();
    const rawBody = JSON.stringify(payload);
    const headers = {
      "content-type": "application/json",
      "linear-signature": sign(config.linearWebhookSecret, rawBody),
      "linear-timestamp": String(payload.webhookTimestamp),
    };

    const first = await fetch(url, { method: "POST", headers, body: rawBody });
    const second = await fetch(url, { method: "POST", headers, body: rawBody });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
    expect(linearClient.createAgentActivity).toHaveBeenCalledOnce();
  });

  it("dedupes concurrent duplicate deliveries while first request is in flight", async () => {
    let resolveDispatch: (value: void | PromiseLike<void>) => void = () => undefined;
    const dispatchGate = new Promise<void>((resolve) => {
      resolveDispatch = resolve;
    });
    const dispatcher = {
      dispatch: vi.fn(async () => {
        await dispatchGate;
      }),
    } satisfies LinearBridgeDispatcher;

    const { linearClient, url } = await startServer(dispatcher);
    const payload = makePayload();
    const rawBody = JSON.stringify(payload);
    const headers = {
      "content-type": "application/json",
      "linear-signature": sign(config.linearWebhookSecret, rawBody),
      "linear-timestamp": String(payload.webhookTimestamp),
    };

    const firstRequest = fetch(url, { method: "POST", headers, body: rawBody });
    await vi.waitFor(() => {
      expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    });

    const secondRequest = await fetch(url, { method: "POST", headers, body: rawBody });
    expect(secondRequest.status).toBe(200);
    await expect(secondRequest.text()).resolves.toBe("OK");

    resolveDispatch(undefined);

    const firstResponse = await firstRequest;
    expect(firstResponse.status).toBe(200);
    await expect(firstResponse.text()).resolves.toBe("OK");
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    expect(linearClient.createAgentActivity).toHaveBeenCalledOnce();
  });

  it("signals terminal async dispatch failures and surfaces them via waitForIdle", async () => {
    const store = new MemorySessionRoomStore();
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const linearClient = {
      createAgentActivity: vi
        .fn()
        .mockRejectedValueOnce(new Error("initial error reporting failed"))
        .mockResolvedValueOnce({ ok: true }),
      agentSessionUpdateExternalUrl: vi.fn(async () => ({ success: true })),
    };
    const thenvoiRest = {
      getAgentMe: vi.fn(async () => ({ id: "agent-1", handle: "linear-host" })),
      createChat: vi.fn(async () => {
        throw new Error("createChat failed");
      }),
    };
    const dispatcher = createInProcessLinearBridgeDispatcher({ logger });

    dispatcher.dispatch({
      eventKey: "session-1:created:terminal-failure",
      input: {
        payload: makePayload() as never,
        config,
        deps: {
          thenvoiRest: thenvoiRest as never,
          linearClient: linearClient as never,
          store,
          logger,
        },
      },
    });

    if (!dispatcher.waitForIdle) {
      throw new Error("Expected in-process dispatcher to expose waitForIdle()");
    }

    await expect(dispatcher.waitForIdle()).rejects.toThrow(
      "Linear bridge async dispatch failed for 1 event(s)",
    );

    expect(linearClient.createAgentActivity).toHaveBeenCalledTimes(2);
    expect(linearClient.createAgentActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        agentSessionId: "session-1",
        content: expect.objectContaining({
          type: "error",
          body: expect.stringContaining("could not recover automatically"),
        }),
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "linear_thenvoi_bridge.async_dispatch_terminal_failure_signaled",
      expect.objectContaining({
        eventKey: "session-1:created:terminal-failure",
        signal: "linear_activity_error",
      }),
    );
  });
});
