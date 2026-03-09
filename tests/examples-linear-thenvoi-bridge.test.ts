import { describe, expect, it, vi } from "vitest";

import {
  createLinearThenvoiBridgeApp,
  createEmbeddedLinearBridgeDispatcher,
  resolveRestApiKeyForMode,
} from "../examples/linear-thenvoi/linear-thenvoi-bridge-server";
import { createLinearThenvoiBridgeAgent } from "../examples/linear-thenvoi/linear-thenvoi-bridge-agent";
import {
  createLinearThenvoiCoderAgent,
  createLinearThenvoiPlannerAgent,
  resolveSpecialistWorkspace,
} from "../examples/linear-thenvoi/linear-thenvoi-specialist-agent";
import { LinearThenvoiExampleRestApi } from "../examples/linear-thenvoi/linear-thenvoi-rest-stub";
import type { Agent } from "../src/index";
import type { Logger } from "../src/core";
import type {
  HandleAgentSessionEventInput,
  PendingBootstrapRequest,
  SessionRoomRecord,
  SessionRoomStore,
} from "../src/linear";

function createLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

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

  public async markCanceled(_sessionId: string): Promise<void> {
    return;
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

class RejectingRoomEventRestApi extends LinearThenvoiExampleRestApi {
  public override async createChatEvent(
    _chatId: string,
    _event: {
      content: string;
      messageType: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>> {
    throw new Error("POST /api/v1/agent/chats/room-1/events failed (403; response body omitted; content-type=text/html)");
  }
}

function makePayload(sessionId: string, issueId: string): HandleAgentSessionEventInput["payload"] {
  return {
    action: "created",
    type: "AgentSessionEvent",
    appUserId: "app-user",
    createdAt: new Date(),
    oauthClientId: "oauth-client",
    organizationId: "org-1",
    webhookId: "webhook-1",
    webhookTimestamp: Date.now(),
    promptContext: `Please handle session ${sessionId}`,
    agentSession: {
      id: sessionId,
      issueId,
      status: "active",
      type: "issue",
      appUserId: "app-user",
      createdAt: new Date().toISOString(),
      organizationId: "org-1",
      updatedAt: new Date().toISOString(),
      issue: {
        id: issueId,
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

describe("linear thenvoi examples", () => {
  it("builds a bridge app without import-time side effects", () => {
    const app = createLinearThenvoiBridgeApp({
      restApi: new LinearThenvoiExampleRestApi(),
      linearAccessToken: "lin_api_test",
      linearWebhookSecret: "linear_webhook_secret",
      stateDbPath: ":memory:",
      hostAgentHandle: "linear-host",
      roomStrategy: "issue",
      writebackMode: "activity_stream",
    });

    expect(app).toBeDefined();
    expect(typeof app.listen).toBe("function");
  });

  it("builds a Thenvoi-hosted Linear bridge agent", () => {
    const agent = createLinearThenvoiBridgeAgent({
      linearAccessToken: "lin_api_test",
    });

    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe("function");
    expect(typeof agent.stop).toBe("function");
  });

  it("builds planner and coder specialists for the realistic demo flow", () => {
    const planner = createLinearThenvoiPlannerAgent({
      agentId: "planner-agent",
      apiKey: "planner-key",
    });
    const coder = createLinearThenvoiCoderAgent({
      agentId: "coder-agent",
      apiKey: "coder-key",
    });

    expect(planner).toBeDefined();
    expect(coder).toBeDefined();
    expect(typeof planner.run).toBe("function");
    expect(typeof coder.run).toBe("function");
  });

  it("creates isolated temp workspaces for specialists by default", () => {
    const plannerWorkspace = resolveSpecialistWorkspace({
      workspaceMode: "temp",
      workspacePrefix: "thenvoi-linear-test-planner-",
    });
    const coderWorkspace = resolveSpecialistWorkspace({
      workspaceMode: "temp",
      workspacePrefix: "thenvoi-linear-test-coder-",
    });

    expect(plannerWorkspace).toContain("thenvoi-linear-test-planner-");
    expect(coderWorkspace).toContain("thenvoi-linear-test-coder-");
    expect(plannerWorkspace).not.toBe(coderWorkspace);
  });

  it("uses the embedded bridge runtime api key in embedded mode", () => {
    const logger = createLogger();
    const originalTransportKey = process.env.THENVOI_BRIDGE_API_KEY;
    process.env.THENVOI_BRIDGE_API_KEY = "transport-key";

    try {
      const apiKey = resolveRestApiKeyForMode({
        logger,
        embedBridgeAgent: true,
        embeddedBridgeConfig: {
          agentId: "bridge-agent",
          apiKey: "embedded-bridge-key",
        },
      });

      expect(apiKey).toBe("embedded-bridge-key");
      expect(logger.warn).toHaveBeenCalledWith(
        "linear_thenvoi_bridge.embedded_mode_ignoring_transport_api_key",
        { runtimeConfigKey: "linear_thenvoi_bridge" },
      );
    } finally {
      if (originalTransportKey === undefined) {
        delete process.env.THENVOI_BRIDGE_API_KEY;
      } else {
        process.env.THENVOI_BRIDGE_API_KEY = originalTransportKey;
      }
    }
  });

  it("keeps using the transport api key outside embedded mode", () => {
    const logger = createLogger();
    const originalTransportKey = process.env.THENVOI_BRIDGE_API_KEY;
    process.env.THENVOI_BRIDGE_API_KEY = "transport-key";

    try {
      const apiKey = resolveRestApiKeyForMode({
        logger,
        embedBridgeAgent: false,
        embeddedBridgeConfig: {
          agentId: "bridge-agent",
          apiKey: "embedded-bridge-key",
        },
      });

      expect(apiKey).toBe("transport-key");
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      if (originalTransportKey === undefined) {
        delete process.env.THENVOI_BRIDGE_API_KEY;
      } else {
        process.env.THENVOI_BRIDGE_API_KEY = originalTransportKey;
      }
    }
  });

  it("retries embedded bootstrap when room event posting is transiently forbidden", async () => {
    const store = new MemorySessionRoomStore();
    const logger = createLogger();
    const bootstrapRoomMessage = vi
      .fn<Agent["bootstrapRoomMessage"]>()
      .mockRejectedValueOnce(new Error("POST /api/v1/agent/chats/room-1/events failed (403; response body omitted; content-type=text/html)"))
      .mockResolvedValue(undefined);
    const resetRoomSession = vi.fn<Agent["resetRoomSession"]>().mockResolvedValue(true);
    const agent = {
      bootstrapRoomMessage,
      resetRoomSession,
    } as unknown as Agent;

    const dispatcher = createEmbeddedLinearBridgeDispatcher({
      agent,
      store,
      logger,
    });

    const restApi = new LinearThenvoiExampleRestApi();
    await restApi.createChat();
    await store.upsert({
      linearSessionId: "session-1",
      linearIssueId: "issue-1",
      thenvoiRoomId: "room-1",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await store.enqueueBootstrapRequest({
      eventKey: "session-1:created",
      linearSessionId: "session-1",
      thenvoiRoomId: "room-1",
      expectedContent: "bootstrap me",
      messageType: "task",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    dispatcher.dispatch({
      eventKey: "session-1:created",
      input: {
        payload: makePayload("session-1", "issue-1"),
        config: {
          linearAccessToken: "lin_api_test",
          linearWebhookSecret: "linear_webhook_secret",
          hostAgentHandle: "linear-host",
          roomStrategy: "issue",
          writebackMode: "activity_stream",
        },
        deps: {
          thenvoiRest: restApi,
          linearClient: {
            createAgentActivity: vi.fn(async () => ({ ok: true })),
          } as never,
          store,
          logger,
        },
      },
    });

    await vi.waitFor(() => {
      expect(bootstrapRoomMessage).toHaveBeenCalledTimes(2);
    }, { timeout: 3_000 });
    await expect(store.listPendingBootstrapRequests()).resolves.toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "linear_thenvoi_bridge.embedded_dispatch_retrying",
      expect.objectContaining({
        eventKey: "session-1:created",
        attempt: 1,
      }),
    );
  });

  it("bootstraps embedded sessions without requiring a room event write", async () => {
    const store = new MemorySessionRoomStore();
    const logger = createLogger();
    const bootstrapRoomMessage = vi.fn<Agent["bootstrapRoomMessage"]>().mockResolvedValue(undefined);
    const resetRoomSession = vi.fn<Agent["resetRoomSession"]>().mockResolvedValue(true);
    const agent = {
      bootstrapRoomMessage,
      resetRoomSession,
    } as unknown as Agent;
    const dispatcher = createEmbeddedLinearBridgeDispatcher({
      agent,
      store,
      logger,
    });
    const restApi = new RejectingRoomEventRestApi();

    dispatcher.dispatch({
      eventKey: "session-1:created",
      input: {
        payload: makePayload("session-1", "issue-1"),
        config: {
          linearAccessToken: "lin_api_test",
          linearWebhookSecret: "linear_webhook_secret",
          hostAgentHandle: "linear-host",
          roomStrategy: "issue",
          writebackMode: "activity_stream",
        },
        deps: {
          thenvoiRest: restApi,
          linearClient: {
            createAgentActivity: vi.fn(async () => ({ ok: true })),
          } as never,
          store,
          logger,
        },
      },
    });

    await vi.waitFor(() => {
      expect(bootstrapRoomMessage).toHaveBeenCalledTimes(1);
    }, { timeout: 3_000 });
    expect(restApi.roomEvents).toHaveLength(0);
    await expect(store.listPendingBootstrapRequests()).resolves.toHaveLength(0);
  });

  it("resets the reused issue room before embedded bootstrap when requested", async () => {
    const store = new MemorySessionRoomStore();
    const logger = createLogger();
    const bootstrapRoomMessage = vi.fn<Agent["bootstrapRoomMessage"]>().mockResolvedValue(undefined);
    const resetRoomSession = vi.fn<Agent["resetRoomSession"]>().mockResolvedValue(true);
    const agent = {
      bootstrapRoomMessage,
      resetRoomSession,
    } as unknown as Agent;
    const dispatcher = createEmbeddedLinearBridgeDispatcher({
      agent,
      store,
      logger,
    });
    const restApi = new LinearThenvoiExampleRestApi();

    await restApi.createChat();
    await store.upsert({
      linearSessionId: "session-1",
      linearIssueId: "issue-1",
      thenvoiRoomId: "room-1",
      status: "completed",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    dispatcher.dispatch({
      eventKey: "session-2:created",
      input: {
        payload: makePayload("session-2", "issue-1"),
        config: {
          linearAccessToken: "lin_api_test",
          linearWebhookSecret: "linear_webhook_secret",
          hostAgentHandle: "linear-host",
          roomStrategy: "issue",
          writebackMode: "activity_stream",
        },
        deps: {
          thenvoiRest: restApi,
          linearClient: {
            createAgentActivity: vi.fn(async () => ({ ok: true })),
          } as never,
          store,
          logger,
        },
      },
    });

    await vi.waitFor(() => {
      expect(resetRoomSession).toHaveBeenCalledWith("room-1", 5_000);
      expect(bootstrapRoomMessage).toHaveBeenCalledTimes(1);
    }, { timeout: 3_000 });
    expect(resetRoomSession.mock.invocationCallOrder[0]).toBeLessThan(
      bootstrapRoomMessage.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });
});
