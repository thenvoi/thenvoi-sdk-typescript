import { describe, expect, it } from "vitest";

import {
  handleAgentSessionEvent,
  type HandleAgentSessionEventInput,
  type LinearThenvoiBridgeConfig,
  type SessionRoomRecord,
  type SessionRoomStore,
} from "../src/index";
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

function makeConfig(roomStrategy: "issue" | "session"): LinearThenvoiBridgeConfig {
  return {
    linearAccessToken: "lin_api_test",
    linearWebhookSecret: "linear_webhook_secret",
    hostAgentHandle: "linear-host",
    defaultSpecialistHandles: [],
    roomStrategy,
    writebackMode: "final_only",
  };
}

function makePayload(sessionId: string, issueId: string) {
  const payload: HandleAgentSessionEventInput["payload"] = {
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

  return payload;
}

function makeLinearClient(): HandleAgentSessionEventInput["deps"]["linearClient"] {
  return {
    createAgentActivity: async () => ({ ok: true }),
  } as unknown as HandleAgentSessionEventInput["deps"]["linearClient"];
}

describe("linear bridge room strategy", () => {
  it("reuses one room per issue when roomStrategy=issue", async () => {
    const restApi = new LinearThenvoiExampleRestApi();
    const store = new MemorySessionRoomStore();

    await handleAgentSessionEvent({
      payload: makePayload("session-1", "issue-1"),
      config: makeConfig("issue"),
      deps: {
        thenvoiRest: restApi,
        linearClient: makeLinearClient(),
        store,
      },
    });

    await handleAgentSessionEvent({
      payload: makePayload("session-2", "issue-1"),
      config: makeConfig("issue"),
      deps: {
        thenvoiRest: restApi,
        linearClient: makeLinearClient(),
        store,
      },
    });

    expect(restApi.roomMessages).toHaveLength(2);
    expect(restApi.roomMessages[0]?.roomId).toBe(restApi.roomMessages[1]?.roomId);
  });

  it("creates one room per session when roomStrategy=session", async () => {
    const restApi = new LinearThenvoiExampleRestApi();
    const store = new MemorySessionRoomStore();

    await handleAgentSessionEvent({
      payload: makePayload("session-1", "issue-1"),
      config: makeConfig("session"),
      deps: {
        thenvoiRest: restApi,
        linearClient: makeLinearClient(),
        store,
      },
    });

    await handleAgentSessionEvent({
      payload: makePayload("session-2", "issue-1"),
      config: makeConfig("session"),
      deps: {
        thenvoiRest: restApi,
        linearClient: makeLinearClient(),
        store,
      },
    });

    expect(restApi.roomMessages).toHaveLength(2);
    expect(restApi.roomMessages[0]?.roomId).not.toBe(restApi.roomMessages[1]?.roomId);
  });
});
