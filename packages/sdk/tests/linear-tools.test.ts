import { describe, expect, it, vi } from "vitest";

import {
  createLinearTools,
  type LinearActivityClient,
  type PendingBootstrapRequest,
  type SessionRoomRecord,
  type SessionRoomStore,
} from "../src/linear";
import { customToolToOpenAISchema, executeCustomTool } from "../src/runtime/tools/customTools";

const TEST_ISSUE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TEST_ISSUE_ID = "22222222-2222-4222-8222-222222222222";

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

function makeMockClient(): LinearActivityClient {
  return {
    createAgentActivity: vi.fn(async () => ({ ok: true })),
    updateIssue: vi.fn(async () => ({ ok: true })),
    createComment: vi.fn(async () => ({ ok: true })),
    workflowStates: vi.fn(async ({ teamId }: { teamId?: string } = {}) => ({
      nodes: [
        { id: "state-0", name: "Todo", type: "unstarted", position: 0, teamId: teamId ?? "team-1" },
        { id: "state-1", name: "In Progress", type: "started", position: 1, teamId: teamId ?? "team-1" },
        { id: "state-2", name: "In Review", type: "started", position: 2, teamId: teamId ?? "team-1" },
        { id: "state-3", name: "Done", type: "completed", position: 3, teamId: teamId ?? "team-1" },
      ],
    })),
    issue: vi.fn(async (issueId: string) => ({
      id: issueId,
      identifier: "SOF-1",
      title: "Example issue",
      description: "Example description",
      url: "https://linear.app/example/issue/SOF-1",
      priority: 2,
      estimate: 3,
      dueDate: "2026-03-08",
      createdAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T01:00:00.000Z",
      state: { id: "state-1", name: "In Progress", type: "started" },
      assignee: { id: "user-1", name: "Darvell" },
      team: { id: "team-1", key: "SOF", name: "SoftwareFactory" },
      comments: vi.fn(async () => ({
        nodes: [
          {
            id: "comment-1",
            body: "Implemented and verified.",
            createdAt: "2026-03-06T01:05:00.000Z",
            updatedAt: "2026-03-06T01:05:00.000Z",
            user: { id: "user-1", name: "Darvell" },
          },
        ],
      })),
    })),
  };
}

describe("createLinearTools", () => {
  it("returns the canonical v1 linear tool contract", () => {
    const tools = createLinearTools({ client: makeMockClient() });
    expect(tools).toHaveLength(12);

    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      "linear_add_issue_comment",
      "linear_ask_user",
      "linear_get_issue",
      "linear_list_issue_comments",
      "linear_list_workflow_states",
      "linear_post_action",
      "linear_post_error",
      "linear_post_response",
      "linear_post_thought",
      "linear_request_auth",
      "linear_update_issue",
      "linear_update_plan",
    ]);
  });

  it("each tool has a description", () => {
    const tools = createLinearTools({ client: makeMockClient() });
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
    }
  });

  it("linear_post_thought validates and calls the activity layer", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((entry) => entry.name === "linear_post_thought")!;

    const result = await executeCustomTool(tool, {
      session_id: "sess-1",
      body: "Analyzing the issue",
    });

    expect(result).toEqual({ ok: true });
    expect(client.createAgentActivity).toHaveBeenCalledWith({
      agentSessionId: "sess-1",
      content: { type: "thought", body: "Analyzing the issue" },
    });
  });

  it("linear_post_action validates and calls the activity layer", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((entry) => entry.name === "linear_post_action")!;

    const result = await executeCustomTool(tool, {
      session_id: "sess-1",
      body: "Searching codebase",
    });

    expect(result).toEqual({ ok: true });
    expect(client.createAgentActivity).toHaveBeenCalledWith({
      agentSessionId: "sess-1",
      content: { type: "action", action: "Searching codebase", parameter: "" },
    });
  });

  it("linear_ask_user validates and calls the activity layer", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((entry) => entry.name === "linear_ask_user")!;

    const result = await executeCustomTool(tool, {
      session_id: "sess-1",
      body: "Which approach do you prefer?",
    });

    expect(result).toEqual({ ok: true });
    expect(client.createAgentActivity).toHaveBeenCalledWith({
      agentSessionId: "sess-1",
      content: { type: "elicitation", body: "Which approach do you prefer?" },
    });
  });

  it("linear_ask_user sends select signal when options are provided", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((entry) => entry.name === "linear_ask_user")!;

    const result = await executeCustomTool(tool, {
      session_id: "sess-1",
      body: "Which repository?",
      options: [
        { label: "Repo A", value: "repo-a" },
        { label: "Repo B", value: "repo-b" },
      ],
    });

    expect(result).toEqual({ ok: true });
    expect(client.createAgentActivity).toHaveBeenCalledWith({
      agentSessionId: "sess-1",
      content: {
        type: "elicitation",
        body: "Which repository?",
        signal: "select",
        signalMetadata: {
          options: [
            { label: "Repo A", value: "repo-a" },
            { label: "Repo B", value: "repo-b" },
          ],
        },
      },
    });
  });

  it("linear_ask_user falls back to plain elicitation when options is omitted", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((entry) => entry.name === "linear_ask_user")!;

    await executeCustomTool(tool, {
      session_id: "sess-1",
      body: "What do you think?",
    });

    expect(client.createAgentActivity).toHaveBeenCalledWith({
      agentSessionId: "sess-1",
      content: { type: "elicitation", body: "What do you think?" },
    });
  });

  it("linear_request_auth sends auth signal with url and provider", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((entry) => entry.name === "linear_request_auth")!;

    const result = await executeCustomTool(tool, {
      session_id: "sess-1",
      body: "Please link your GitHub account to continue.",
      url: "https://github.com/login/oauth/authorize?client_id=abc",
      provider: "GitHub",
    });

    expect(result).toEqual({ ok: true });
    expect(client.createAgentActivity).toHaveBeenCalledWith({
      agentSessionId: "sess-1",
      content: {
        type: "elicitation",
        body: "Please link your GitHub account to continue.",
        signal: "auth",
        signalMetadata: {
          url: "https://github.com/login/oauth/authorize?client_id=abc",
          provider: "GitHub",
        },
      },
    });
  });

  it("linear_request_auth omits provider when not specified", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((entry) => entry.name === "linear_request_auth")!;

    await executeCustomTool(tool, {
      session_id: "sess-1",
      body: "Please authenticate.",
      url: "https://example.com/auth",
    });

    expect(client.createAgentActivity).toHaveBeenCalledWith({
      agentSessionId: "sess-1",
      content: {
        type: "elicitation",
        body: "Please authenticate.",
        signal: "auth",
        signalMetadata: { url: "https://example.com/auth" },
      },
    });
  });

  it("linear_request_auth rejects invalid url", async () => {
    const tools = createLinearTools({ client: makeMockClient() });
    const tool = tools.find((entry) => entry.name === "linear_request_auth")!;

    await expect(
      executeCustomTool(tool, {
        session_id: "sess-1",
        body: "Please authenticate.",
        url: "not-a-url",
      }),
    ).rejects.toThrow("Invalid arguments");
  });

  it("linear_request_auth rejects non-https url for remote hosts", async () => {
    const tools = createLinearTools({ client: makeMockClient() });
    const tool = tools.find((entry) => entry.name === "linear_request_auth")!;

    await expect(
      executeCustomTool(tool, {
        session_id: "sess-1",
        body: "Please authenticate.",
        url: "ftp://example.com/auth",
      }),
    ).rejects.toThrow("Invalid arguments");

    await expect(
      executeCustomTool(tool, {
        session_id: "sess-1",
        body: "Please authenticate.",
        url: "http://example.com/auth",
      }),
    ).rejects.toThrow("Invalid arguments");
  });

  it("linear_request_auth allows http for localhost", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((entry) => entry.name === "linear_request_auth")!;

    const result = await executeCustomTool(tool, {
      session_id: "sess-1",
      body: "Please authenticate locally.",
      url: "http://localhost:3000/auth/callback",
    });

    expect(result).toEqual({ ok: true });
  });

  it("linear_request_auth allows http for IPv6 localhost", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((entry) => entry.name === "linear_request_auth")!;

    const result = await executeCustomTool(tool, {
      session_id: "sess-1",
      body: "Please authenticate locally.",
      url: "http://[::1]:3000/auth/callback",
    });

    expect(result).toEqual({ ok: true });
  });

  it("linear_request_auth rejects overly long provider name", async () => {
    const tools = createLinearTools({ client: makeMockClient() });
    const tool = tools.find((entry) => entry.name === "linear_request_auth")!;

    await expect(
      executeCustomTool(tool, {
        session_id: "sess-1",
        body: "Please authenticate.",
        url: "https://example.com/auth",
        provider: "A".repeat(101),
      }),
    ).rejects.toThrow("Invalid arguments");
  });

  it("linear_ask_user rejects options with fewer than 2 items", async () => {
    const tools = createLinearTools({ client: makeMockClient() });
    const tool = tools.find((entry) => entry.name === "linear_ask_user")!;

    await expect(
      executeCustomTool(tool, {
        session_id: "sess-1",
        body: "Pick one",
        options: [{ label: "Only", value: "only" }],
      }),
    ).rejects.toThrow("Invalid arguments");
  });

  it("linear_request_auth and linear_ask_user are excluded when enableElicitation is false", () => {
    const tools = createLinearTools({ client: makeMockClient(), enableElicitation: false });
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("linear_ask_user");
    expect(names).not.toContain("linear_request_auth");
  });

  it("linear_post_response posts the final response and marks the session completed", async () => {
    const client = makeMockClient();
    const store = new MemorySessionRoomStore();
    await store.upsert({
      linearSessionId: "sess-1",
      linearIssueId: "issue-1",
      thenvoiRoomId: "room-1",
      status: "active",
      lastEventKey: "event-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const tools = createLinearTools({ client, store });
    const tool = tools.find((entry) => entry.name === "linear_post_response")!;

    const result = await executeCustomTool(tool, {
      session_id: "sess-1",
      body: "Final answer",
    });

    expect(result).toEqual({ ok: true });
    expect(client.createAgentActivity).toHaveBeenCalledWith({
      agentSessionId: "sess-1",
      content: { type: "response", body: "Final answer" },
    });
    await expect(store.getBySessionId("sess-1")).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("linear_update_plan validates steps and calls the activity layer", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((entry) => entry.name === "linear_update_plan")!;

    const result = await executeCustomTool(tool, {
      session_id: "sess-1",
      steps: [
        { title: "Step 1", status: "completed" },
        { title: "Step 2", status: "in_progress" },
      ],
    });

    expect(result).toEqual({ ok: true });
    expect(client.createAgentActivity).toHaveBeenCalledOnce();
  });

  it("rejects invalid input with Zod validation error", async () => {
    const tools = createLinearTools({ client: makeMockClient() });
    const tool = tools.find((entry) => entry.name === "linear_post_thought")!;

    await expect(
      executeCustomTool(tool, { session_id: 123 as unknown as string }),
    ).rejects.toThrow("Invalid arguments");
  });

  it("rejects invalid plan step status", async () => {
    const tools = createLinearTools({ client: makeMockClient() });
    const tool = tools.find((entry) => entry.name === "linear_update_plan")!;

    await expect(
      executeCustomTool(tool, {
        session_id: "sess-1",
        steps: [{ title: "Step 1", status: "invalid_status" }],
      }),
    ).rejects.toThrow("Invalid arguments");
  });

  it("linear_update_issue updates issue fields through the Linear client", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((entry) => entry.name === "linear_update_issue")!;

    const result = await executeCustomTool(tool, {
      issue_id: TEST_ISSUE_ID,
      title: "Updated title",
      priority: 2,
      assignee_id: null,
    });

    expect(result).toEqual({ ok: true });
    expect(client.updateIssue).toHaveBeenCalledWith(
      TEST_ISSUE_ID,
      expect.objectContaining({
        title: "Updated title",
        priority: 2,
        assigneeId: null,
      }),
    );
  });

  it("linear_get_issue returns normalized issue details", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((entry) => entry.name === "linear_get_issue")!;

    const result = await executeCustomTool(tool, {
      issue_id: TEST_ISSUE_ID,
    });

    expect(result).toEqual({
      issue: expect.objectContaining({
        id: TEST_ISSUE_ID,
        identifier: "SOF-1",
        title: "Example issue",
        team: expect.objectContaining({ key: "SOF" }),
      }),
    });
    expect(client.issue).toHaveBeenCalledWith(TEST_ISSUE_ID);
  });

  it("issue tools expose issue_id as the canonical input key", () => {
    const tools = createLinearTools({ client: makeMockClient() });
    const tool = tools.find((entry) => entry.name === "linear_get_issue")!;
    const schema = customToolToOpenAISchema(tool) as {
      function?: {
        parameters?: {
          properties?: Record<string, unknown>;
        };
      };
    };
    const properties = schema.function?.parameters?.properties ?? {};

    expect(properties).toHaveProperty("issue_id");
    expect(properties).not.toHaveProperty("issueId");
    expect(properties).not.toHaveProperty("id");
  });

  it("rejects non-canonical issue id aliases", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((entry) => entry.name === "linear_get_issue")!;

    await expect(executeCustomTool(tool, {
      issueId: TEST_ISSUE_ID,
    })).rejects.toThrow("requires issue_id");
    await expect(executeCustomTool(tool, {
      id: OTHER_TEST_ISSUE_ID,
    })).rejects.toThrow("requires issue_id");
    expect(client.issue).not.toHaveBeenCalled();
  });

  it("uses canonical issue_id even when unknown extra fields are present", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((entry) => entry.name === "linear_get_issue")!;

    await executeCustomTool(tool, {
      issue_id: TEST_ISSUE_ID,
      issueId: OTHER_TEST_ISSUE_ID,
      id: OTHER_TEST_ISSUE_ID,
    });

    expect(client.issue).toHaveBeenCalledWith(TEST_ISSUE_ID);
  });

  it("linear_list_issue_comments returns recent comments", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((entry) => entry.name === "linear_list_issue_comments")!;

    const result = await executeCustomTool(tool, {
      issue_id: TEST_ISSUE_ID,
      limit: 10,
    });

    expect(result).toEqual({
      comments: [
        expect.objectContaining({
          id: "comment-1",
          body: "Implemented and verified.",
        }),
      ],
    });
    expect(client.issue).toHaveBeenCalledWith(TEST_ISSUE_ID);
  });

  it("linear_list_workflow_states returns normalized states for the issue team", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((entry) => entry.name === "linear_list_workflow_states")!;

    const result = await executeCustomTool(tool, {
      issue_id: TEST_ISSUE_ID,
    });

    expect(result).toEqual({
      team_id: "team-1",
      states: [
        expect.objectContaining({ id: "state-0", name: "Todo", type: "unstarted", team_id: "team-1" }),
        expect.objectContaining({ id: "state-1", name: "In Progress", type: "started", team_id: "team-1" }),
        expect.objectContaining({ id: "state-2", name: "In Review", type: "started", team_id: "team-1" }),
        expect.objectContaining({ id: "state-3", name: "Done", type: "completed", team_id: "team-1" }),
      ],
    });
    expect(client.issue).toHaveBeenCalledWith(TEST_ISSUE_ID);
    expect(client.workflowStates).toHaveBeenCalledWith({ teamId: "team-1" });
  });

  it("linear_add_issue_comment posts a comment through the Linear client", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((entry) => entry.name === "linear_add_issue_comment")!;

    const result = await executeCustomTool(tool, {
      issue_id: TEST_ISSUE_ID,
      body: "Implemented and verified.",
    });

    expect(result).toEqual({ ok: true });
    expect(client.createComment).toHaveBeenCalledWith({
      issueId: TEST_ISSUE_ID,
      body: "Implemented and verified.",
    });
  });
});
