import { describe, expect, it } from "vitest";

import {
  handleAgentSessionEvent,
  type HandleAgentSessionEventInput,
  type LinearThenvoiBridgeConfig,
  type SessionRoomRecord,
  type SessionRoomStore,
} from "../src/index";
import { LinearThenvoiExampleRestApi } from "../examples/linear-thenvoi-rest-stub";

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
        url: "https://linear.app/thenvoi/issue/INT-1",
      },
      comment: {
        id: "comment-1",
        body: "Need a clear summary",
      },
    },
  };

  return payload;
}

function makeLinearClient(): HandleAgentSessionEventInput["deps"]["linearClient"] {
  return {
    createAgentActivity: async () => ({ ok: true }),
  } as unknown as HandleAgentSessionEventInput["deps"]["linearClient"];
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
});
