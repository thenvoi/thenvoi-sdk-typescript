import { describe, expect, it, vi } from "vitest";

import {
  createLinearThenvoiBridgeApp,
  createEmbeddedLinearBridgeDispatcher,
  createRateLimitedRestApi,
  resolveRestApiKeyForMode,
} from "../examples/linear-thenvoi/linear-thenvoi-bridge-server";
import {
  buildLinearThenvoiBridgePrompt,
  createLinearThenvoiBridgeAgent,
} from "../examples/linear-thenvoi/linear-thenvoi-bridge-agent";
import {
  createLinearThenvoiPlannerAgent,
  createLinearThenvoiReviewerAgent,
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
import { ExecutionContext } from "../src/runtime/ExecutionContext";

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

class RetryOnceRoomEventRestApi extends LinearThenvoiExampleRestApi {
  public attempts = 0;

  public override async createChatEvent(
    chatId: string,
    event: {
      content: string;
      messageType: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>> {
    this.attempts += 1;
    if (this.attempts === 1) {
      throw new Error("Status code: 429");
    }

    return super.createChatEvent(chatId, event);
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

  it("exposes thenvoi_lookup_peers on the bridge room tool surface", () => {
    const restApi = new LinearThenvoiExampleRestApi({
      peers: [
        { id: "peer-host", name: "Thenvoi Linear Bridge", handle: "linear-host" },
        { id: "peer-planner", name: "Claude Planner", handle: "claude-planner" },
      ],
      agentId: "peer-host",
      agentName: "Thenvoi Linear Bridge",
      agentHandle: "linear-host",
    });
    const context = new ExecutionContext({
      roomId: "room-1",
      link: { rest: restApi },
      maxContextMessages: 20,
    });

    const toolNames = context.getTools()
      .getOpenAIToolSchemas()
      .map((entry) => (entry.function as { name?: string } | undefined)?.name);

    expect(toolNames).toContain("thenvoi_lookup_peers");
    expect(typeof context.getTools().lookupPeers).toBe("function");
  });

  it("documents the real Linear tool names in the bridge prompt", () => {
    const prompt = buildLinearThenvoiBridgePrompt();

    expect(prompt).toContain("linear_post_thought");
    expect(prompt).toContain("linear_post_action");
    expect(prompt).toContain("linear_post_response");
    expect(prompt).not.toContain("complete_session");
  });

  it("builds planner and reviewer specialists for the realistic demo flow", () => {
    const planner = createLinearThenvoiPlannerAgent({
      agentId: "planner-agent",
      apiKey: "planner-key",
    });
    const reviewer = createLinearThenvoiReviewerAgent({
      agentId: "reviewer-agent",
      apiKey: "reviewer-key",
    });

    expect(planner).toBeDefined();
    expect(reviewer).toBeDefined();
    expect(typeof planner.run).toBe("function");
    expect(typeof reviewer.run).toBe("function");
  });

  it("creates isolated temp workspaces for specialists by default", () => {
    const plannerWorkspace = resolveSpecialistWorkspace({
      workspaceMode: "temp",
      workspacePrefix: "thenvoi-linear-test-planner-",
    });
    const reviewerWorkspace = resolveSpecialistWorkspace({
      workspaceMode: "temp",
      workspacePrefix: "thenvoi-linear-test-reviewer-",
    });

    expect(plannerWorkspace).toContain("thenvoi-linear-test-planner-");
    expect(reviewerWorkspace).toContain("thenvoi-linear-test-reviewer-");
    expect(plannerWorkspace).not.toBe(reviewerWorkspace);
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

  it("retries rate-limited Thenvoi REST calls before surfacing failure", async () => {
    const logger = createLogger();
    const restApi = createRateLimitedRestApi({
      api: new RetryOnceRoomEventRestApi(),
      minIntervalMs: 0,
      retryLimit: 1,
      retryBaseDelayMs: 0,
      logger,
    });

    await expect(
      restApi.createChatEvent("room-1", {
        content: "hello",
        messageType: "task",
      }),
    ).resolves.toEqual({ ok: true });
    expect(logger.warn).toHaveBeenCalledWith(
      "linear_thenvoi_bridge.rest_rate_limited_retrying",
      expect.objectContaining({
        operation: "createChatEvent",
        attempt: 1,
      }),
    );
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

  it("processes bootstrap room messages immediately even before queue sync settles", async () => {
    const runtimeModule = await import("../src/runtime/PlatformRuntime");
    const executionSpy = vi.fn().mockResolvedValue(undefined);
    let releaseNextMessage: (() => void) | null = null;
    const runtime = new runtimeModule.PlatformRuntime({
      agentId: "agent-1",
      apiKey: "key-1",
      identity: { name: "Bridge", description: "Bridge" },
      link: {
        isConnected: () => true,
        connect: vi.fn().mockResolvedValue(undefined),
        subscribeAgentRooms: vi.fn().mockResolvedValue(undefined),
        subscribeAgentContacts: vi.fn().mockResolvedValue(undefined),
        unsubscribeAgentContacts: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        nextEvent: vi.fn(),
        subscribeRoom: vi.fn().mockResolvedValue(undefined),
        unsubscribeRoom: vi.fn().mockResolvedValue(undefined),
        getStaleProcessingMessages: vi.fn().mockResolvedValue([]),
        getNextMessage: vi.fn(() => new Promise((resolve) => {
          releaseNextMessage = () => resolve(null);
        })),
        markProcessing: vi.fn().mockResolvedValue(undefined),
        markProcessed: vi.fn().mockResolvedValue(undefined),
        markFailed: vi.fn().mockResolvedValue(undefined),
        rest: new LinearThenvoiExampleRestApi(),
        capabilities: { peers: true, contacts: false, memory: false },
      } as never,
    });
    const adapter = {
      onStarted: vi.fn().mockResolvedValue(undefined),
      onCleanup: vi.fn().mockResolvedValue(undefined),
      onEvent: executionSpy,
    };

    await runtime.start(adapter as never);
    await runtime.bootstrapRoomMessage("room-1", {
      id: "bootstrap-1",
      roomId: "room-1",
      content: "hello",
      senderId: "user-1",
      senderType: "User",
      senderName: "User",
      messageType: "task",
      metadata: {},
      createdAt: new Date(),
    });

    expect(executionSpy).toHaveBeenCalledTimes(1);
    if (releaseNextMessage !== null) {
      (releaseNextMessage as () => void)();
    }
    await runtime.stop(0);
  });

});
