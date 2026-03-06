import { describe, expect, it, vi } from "vitest";

import {
  handleAgentSessionEvent,
  type HandleAgentSessionEventInput,
  type LinearThenvoiBridgeConfig,
  type SessionRoomRecord,
  type SessionRoomStore,
} from "../src/linear";
import { LinearThenvoiExampleRestApi } from "../examples/linear-thenvoi/linear-thenvoi-rest-stub";

class MemorySessionRoomStore implements SessionRoomStore {
  private readonly records = new Map<string, SessionRoomRecord>();

  public async getBySessionId(sessionId: string): Promise<SessionRoomRecord | null> {
    return this.records.get(sessionId) ?? null;
  }

  public async getByIssueId(issueId: string): Promise<SessionRoomRecord | null> {
    const values = [...this.records.values()]
      .filter((record) => record.linearIssueId === issueId && record.status === "active")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    return values[0] ?? null;
  }

  public async upsert(record: SessionRoomRecord): Promise<void> {
    this.records.set(record.linearSessionId, record);
  }

  public async markCanceled(sessionId: string): Promise<void> {
    const current = this.records.get(sessionId);
    if (!current) {
      return;
    }

    this.records.set(sessionId, {
      ...current,
      status: "canceled",
      updatedAt: new Date().toISOString(),
    });
  }
}

const config: LinearThenvoiBridgeConfig = {
  linearAccessToken: "lin_api_test",
  linearWebhookSecret: "linear_webhook_secret",
  hostAgentHandle: "linear-host",
  defaultSpecialistHandles: ["research-agent"],
  roomStrategy: "issue",
  writebackMode: "final_only",
};

function makePayload(action: "created" | "updated" | "canceled") {
  const payload: HandleAgentSessionEventInput["payload"] = {
    action,
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
      status: action === "canceled" ? "canceled" : "active",
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
      comment: {
        id: "comment-1",
        body: "Need a clear summary",
      },
    },
  };

  return payload;
}

function makeLinearClient(): HandleAgentSessionEventInput["deps"]["linearClient"] & {
  createAgentActivity: ReturnType<typeof vi.fn>;
} {
  return {
    createAgentActivity: vi.fn(async () => ({ ok: true })),
  } as unknown as HandleAgentSessionEventInput["deps"]["linearClient"] & {
    createAgentActivity: ReturnType<typeof vi.fn>;
  };
}

describe("linear bridge webhook actions", () => {
  it("forwards created/updated events to Thenvoi room messages", async () => {
    const restApi = new LinearThenvoiExampleRestApi();
    const store = new MemorySessionRoomStore();

    await handleAgentSessionEvent({
      payload: makePayload("created"),
      config,
      deps: {
        thenvoiRest: restApi,
        linearClient: makeLinearClient(),
        store,
      },
    });

    await handleAgentSessionEvent({
      payload: makePayload("updated"),
      config,
      deps: {
        thenvoiRest: restApi,
        linearClient: makeLinearClient(),
        store,
      },
    });

    expect(restApi.roomMessages).toHaveLength(2);
    expect(restApi.roomMessages[0]?.content).toContain("Agent session created");
    expect(restApi.roomMessages[1]?.content).toContain("Agent session updated");
    expect(restApi.roomMessages[0]?.metadata?.linear_session_id).toBe("session-1");
    expect(restApi.roomMessages[0]?.metadata?.linear_bridge).toBe("thenvoi");
  });

  it("marks session canceled and emits a cancellation event", async () => {
    const restApi = new LinearThenvoiExampleRestApi();
    const store = new MemorySessionRoomStore();

    await handleAgentSessionEvent({
      payload: makePayload("created"),
      config,
      deps: {
        thenvoiRest: restApi,
        linearClient: makeLinearClient(),
        store,
      },
    });

    await handleAgentSessionEvent({
      payload: makePayload("canceled"),
      config,
      deps: {
        thenvoiRest: restApi,
        linearClient: makeLinearClient(),
        store,
      },
    });

    expect(restApi.roomEvents).toHaveLength(1);
    expect(restApi.roomEvents[0]?.content).toContain("session canceled");

    await expect(store.getBySessionId("session-1")).resolves.toMatchObject({
      status: "canceled",
    });
  });

  it("sends acknowledgment thought on created events only", async () => {
    const restApi = new LinearThenvoiExampleRestApi();
    const store = new MemorySessionRoomStore();
    const linearClient = makeLinearClient();

    await handleAgentSessionEvent({
      payload: makePayload("created"),
      config,
      deps: { thenvoiRest: restApi, linearClient, store },
    });

    // Acknowledgment should be the first call to createAgentActivity
    expect(linearClient.createAgentActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionId: "session-1",
        content: expect.objectContaining({
          type: "thought",
          body: "Received session. Setting up workspace...",
        }),
      }),
    );
  });

  it("does not send acknowledgment on updated events", async () => {
    const restApi = new LinearThenvoiExampleRestApi();
    const store = new MemorySessionRoomStore();
    const linearClient = makeLinearClient();

    // First create so the room exists.
    await handleAgentSessionEvent({
      payload: makePayload("created"),
      config,
      deps: { thenvoiRest: restApi, linearClient, store },
    });

    const updatedClient = makeLinearClient();
    await handleAgentSessionEvent({
      payload: makePayload("updated"),
      config,
      deps: { thenvoiRest: restApi, linearClient: updatedClient, store },
    });

    // Updated event should not trigger any createAgentActivity calls
    expect(updatedClient.createAgentActivity).not.toHaveBeenCalled();
  });

  it("reports errors back to Linear and re-throws", async () => {
    const restApi = new LinearThenvoiExampleRestApi();
    const store = new MemorySessionRoomStore();
    const linearClient = makeLinearClient();

    // Make createChat throw to simulate a failure after acknowledgment.
    const originalCreateChat = restApi.createChat.bind(restApi);
    restApi.createChat = async () => {
      throw new Error("Room creation failed");
    };

    await expect(
      handleAgentSessionEvent({
        payload: makePayload("created"),
        config,
        deps: { thenvoiRest: restApi, linearClient, store },
      }),
    ).rejects.toThrow("Room creation failed");

    // Should have called createAgentActivity twice: acknowledgment + error report
    expect(linearClient.createAgentActivity).toHaveBeenCalledTimes(2);
    expect(linearClient.createAgentActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        agentSessionId: "session-1",
        content: expect.objectContaining({
          type: "error",
          body: expect.stringContaining("Room creation failed"),
        }),
      }),
    );

    // Restore for other tests
    restApi.createChat = originalCreateChat;
  });

  it("forwards prompted action as user response to room", async () => {
    const restApi = new LinearThenvoiExampleRestApi();
    const store = new MemorySessionRoomStore();
    const linearClient = makeLinearClient();

    // First create a session so the room exists.
    await handleAgentSessionEvent({
      payload: makePayload("created"),
      config,
      deps: { thenvoiRest: restApi, linearClient, store },
    });

    const promptedPayload = {
      ...makePayload("created"),
      action: "prompted",
      agentActivity: {
        content: {
          body: "Yes, please proceed with option A",
        },
      },
    } as unknown as HandleAgentSessionEventInput["payload"];

    await handleAgentSessionEvent({
      payload: promptedPayload,
      config,
      deps: { thenvoiRest: restApi, linearClient, store },
    });

    expect(restApi.roomMessages).toHaveLength(2);
    expect(restApi.roomMessages[1]?.content).toContain("[Linear User Response]");
    expect(restApi.roomMessages[1]?.content).toContain("Yes, please proceed with option A");
    expect(restApi.roomMessages[1]?.metadata?.linear_event_action).toBe("prompted");
  });
});
