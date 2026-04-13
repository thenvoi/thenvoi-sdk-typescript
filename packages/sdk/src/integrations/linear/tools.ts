import { z } from "zod";

import type { CustomToolDef } from "../../runtime/tools/customTools";
import type { CandidateRepositoryInput, LinearActivityClient, PlanStep, RepositorySuggestion } from "./activities";
import {
  postThought,
  postAction,
  postError,
  postElicitation,
  updatePlan,
} from "./activities";
import { completeLinearSession } from "./bridge";
import type { SessionRoomStore } from "./types";

interface CreateLinearToolsOptions {
  client: LinearActivityClient;
  store?: SessionRoomStore;
  enableElicitation?: boolean;
}

/**
 * Create Linear activity tools usable by any adapter via `customTools`.
 */
export function createLinearTools(options: CreateLinearToolsOptions): CustomToolDef[] {
  const { client, store, enableElicitation = true } = options;

  const sessionBodySchema = z.object({
    session_id: z.string().describe("The Linear agent session ID"),
    body: z.string().describe("The message body in Markdown format"),
  });
  const issueIdInputSchema = z.object({
    issue_id: z.string().optional().describe("The Linear issue ID (UUID) from the session context"),
  }).passthrough();
  const issueCommentLimitSchema = z.number().int().min(1).max(50).optional()
    .describe("Maximum number of recent comments to return");
  const requiredIssueIdSchema = issueIdInputSchema;
  const optionalIssueIdSchema = issueIdInputSchema;

  const tools: CustomToolDef[] = [];
  const addSessionBodyTool = (
    name: string,
    description: string,
    handler: (args: Record<string, unknown>) => Promise<unknown>,
  ): void => {
    tools.push({
      name,
      description,
      schema: sessionBodySchema,
      handler,
    });
  };

  addSessionBodyTool(
    "linear_post_thought",
    "Post a thought to the Linear agent session, visible to the user as internal reasoning.",
    async (args) => {
      await postThought(client, args.session_id as string, args.body as string);
      return { ok: true };
    },
  );

  addSessionBodyTool(
    "linear_post_action",
    "Post an action to the Linear agent session, showing the user what step is being taken.",
    async (args) => {
      await postAction(client, args.session_id as string, args.body as string);
      return { ok: true };
    },
  );

  addSessionBodyTool(
    "linear_post_error",
    "Post an error to the Linear agent session to notify the user of a failure.",
    async (args) => {
      await postError(client, args.session_id as string, args.body as string);
      return { ok: true };
    },
  );

  if (enableElicitation) {
    addSessionBodyTool(
      "linear_ask_user",
      "Ask the Linear user a question via an elicitation activity.",
      async (args) => {
        await postElicitation(client, args.session_id as string, args.body as string);
        return { ok: true };
      },
    );
  }

  addSessionBodyTool(
    "linear_post_response",
    "Post the final response to the Linear agent session and mark the session completed when a store is available.",
    async (args) => {
      await completeLinearSession({
        linearClient: client,
        agentSessionId: args.session_id as string,
        body: args.body as string,
        store,
      });
      return { ok: true };
    },
  );

  tools.push(
    {
      name: "linear_update_plan",
      description: "Update the plan for the Linear agent session, showing progress on each step.",
      schema: z.object({
        session_id: z.string().describe("The Linear agent session ID"),
        steps: z.array(z.object({
          title: z.string().describe("Step title"),
          status: z.enum(["pending", "in_progress", "completed", "failed"]).describe("Step status"),
        })).describe("The plan steps with their current status"),
      }),
      handler: async (args: Record<string, unknown>) => {
        await updatePlan(
          client,
          args.session_id as string,
          args.steps as PlanStep[],
        );
        return { ok: true };
      },
    },
  );

  addIssueTools({
    tools,
    client,
    requiredIssueIdSchema,
    optionalIssueIdSchema,
    issueCommentLimitSchema,
  });

  if (typeof client.issueRepositorySuggestions === "function") {
    const suggestRepositories = client.issueRepositorySuggestions.bind(client);
    tools.push({
      name: "linear_suggest_repositories",
      description:
        "Ask Linear to rank candidate repositories by relevance for the current issue. " +
        "Returns ranked suggestions with confidence scores. Use this before asking the user " +
        "which repository to work in — if a suggestion has high confidence, auto-select it; " +
        "otherwise present the top options via the select elicitation signal.",
      schema: z.object({
        session_id: z.string().describe("The Linear agent session ID"),
        issue_id: z.string().uuid().describe("The Linear issue ID (UUID)"),
        repositories: z
          .array(
            z.object({
              hostname: z.string().describe("Hostname of the Git service (e.g. 'github.com')"),
              repositoryFullName: z.string().describe("Full name in owner/name format (e.g. 'acme/backend')"),
            }),
          )
          .min(1)
          .describe("Candidate repositories the agent has access to"),
      }),
      handler: async (args: Record<string, unknown>) => {
        const issueId = resolveIssueId("linear_suggest_repositories", args);
        const sessionId = args.session_id as string;
        const candidates = args.repositories as CandidateRepositoryInput[];

        const response = await suggestRepositories(
          candidates,
          issueId,
          { agentSessionId: sessionId },
        );

        const suggestions = extractRepositorySuggestions(response);
        return { suggestions };
      },
    });
  }

  return tools;
}

function addIssueTools(input: {
  tools: CustomToolDef[];
  client: LinearActivityClient;
  requiredIssueIdSchema: z.AnyZodObject;
  optionalIssueIdSchema: z.AnyZodObject;
  issueCommentLimitSchema: z.ZodOptional<z.ZodNumber>;
}): void {
  const {
    tools,
    client,
    requiredIssueIdSchema,
    optionalIssueIdSchema,
    issueCommentLimitSchema,
  } = input;

  tools.push(
    {
      name: "linear_get_issue",
      description: "Fetch the current Linear issue details using the exact issue UUID from the session context.",
      schema: requiredIssueIdSchema,
      handler: async (args: Record<string, unknown>) => {
        const issueId = resolveIssueId("linear_get_issue", args);
        return readIssue(client, issueId);
      },
    },
    {
      name: "linear_list_issue_comments",
      description: "List recent comments for the current Linear issue using the exact issue UUID from the session context.",
      schema: requiredIssueIdSchema.extend({ limit: issueCommentLimitSchema }),
      handler: async (args: Record<string, unknown>) => {
        const issueId = resolveIssueId("linear_list_issue_comments", args);
        return readIssueComments(client, issueId, typeof args.limit === "number" ? args.limit : 20);
      },
    },
    {
      name: "linear_list_workflow_states",
      description: "List workflow states for the current issue's team so the bridge can move the issue between Todo, In Progress, In Review, and Done.",
      schema: optionalIssueIdSchema.extend({
        team_id: z.string().optional().describe("The Linear team ID when already known from the issue context"),
      }),
      handler: async (args: Record<string, unknown>) => {
        const issueId = resolveOptionalIssueId("linear_list_workflow_states", args);

        const teamId = typeof args.team_id === "string" && args.team_id.trim().length > 0
          ? args.team_id
          : await readIssueTeamId(client, issueId);
        if (!teamId) {
          throw new Error("linear_list_workflow_states requires issue_id or team_id.");
        }

        return readWorkflowStates(client, teamId);
      },
    },
    {
      name: "linear_update_issue",
      description: "Update a Linear issue (title/description/state/assignee/priority/etc.) from the session workflow.",
      schema: requiredIssueIdSchema.extend({
        title: z.string().optional().describe("New issue title"),
        description: z.string().optional().describe("New issue description (Markdown)"),
        priority: z.number().int().min(0).max(4).optional().describe("Priority 0-4"),
        state_id: z.string().optional().describe("Workflow state ID"),
        assignee_id: z.string().nullable().optional().describe("Assignee user ID, or null to unassign"),
        estimate: z.number().int().optional().describe("Estimate points"),
        due_date: z.string().optional().describe("Due date ISO string"),
      }),
      handler: async (args: Record<string, unknown>) => {
        if (typeof client.updateIssue !== "function") {
          throw new Error("linear_update_issue is unavailable: Linear client does not support updateIssue().");
        }
        const issueId = resolveIssueId("linear_update_issue", args);

        const hasUpdates = (
          args.title !== undefined
          || args.description !== undefined
          || args.priority !== undefined
          || args.state_id !== undefined
          || args.assignee_id !== undefined
          || args.estimate !== undefined
          || args.due_date !== undefined
        );
        if (!hasUpdates) {
          throw new Error("linear_update_issue requires at least one update field.");
        }

        await client.updateIssue(
          issueId,
          {
            ...(args.title !== undefined ? { title: args.title } : {}),
            ...(args.description !== undefined ? { description: args.description } : {}),
            ...(args.priority !== undefined ? { priority: args.priority } : {}),
            ...(args.state_id !== undefined ? { stateId: args.state_id } : {}),
            ...(args.assignee_id !== undefined ? { assigneeId: args.assignee_id } : {}),
            ...(args.estimate !== undefined ? { estimate: args.estimate } : {}),
            ...(args.due_date !== undefined ? { dueDate: args.due_date } : {}),
          },
        );

        return { ok: true };
      },
    },
    {
      name: "linear_add_issue_comment",
      description: "Add a new comment to a Linear issue.",
      schema: requiredIssueIdSchema.extend({
        body: z.string().describe("Comment body (Markdown)"),
      }),
      handler: async (args: Record<string, unknown>) => {
        if (typeof client.createComment !== "function") {
          throw new Error("linear_add_issue_comment is unavailable: Linear client does not support createComment().");
        }
        const issueId = resolveIssueId("linear_add_issue_comment", args);

        await client.createComment({
          issueId,
          body: args.body as string,
        });

        return { ok: true };
      },
    },
  );
}

function assertUuid(toolName: string, value: string): void {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(value)) {
    throw new Error(`${toolName} requires the exact Linear issue UUID from the session context. Received "${value}".`);
  }
}

function resolveIssueId(toolName: string, args: Record<string, unknown>): string {
  const issueId = resolveOptionalIssueId(toolName, args);
  if (!issueId) {
    throw new Error(`${toolName} requires issue_id.`);
  }

  return issueId;
}

function resolveOptionalIssueId(
  toolName: string,
  args: Record<string, unknown>,
): string | undefined {
  if (typeof args.issue_id !== "string" || args.issue_id.length === 0) {
    return undefined;
  }

  assertUuid(toolName, args.issue_id);
  return args.issue_id;
}

async function readIssue(client: LinearActivityClient, issueId: string): Promise<unknown> {
  if (typeof client.issue !== "function") {
    throw new Error("linear_get_issue is unavailable: Linear client does not support issue().");
  }

  const issue = await client.issue(issueId) as {
    id: string;
    identifier?: string | null;
    title?: string | null;
    description?: string | null;
    url?: string | null;
    priority?: number | null;
    estimate?: number | null;
    dueDate?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    state?: { id?: string | null; name?: string | null; type?: string | null } | null;
    assignee?: { id?: string | null; name?: string | null; displayName?: string | null } | null;
    team?: { id?: string | null; key?: string | null; name?: string | null } | null;
  };

  return {
    issue: {
      id: issue.id,
      identifier: issue.identifier ?? null,
      title: issue.title ?? null,
      description: issue.description ?? null,
      url: issue.url ?? null,
      priority: issue.priority ?? null,
      estimate: issue.estimate ?? null,
      due_date: issue.dueDate ?? null,
      created_at: issue.createdAt ?? null,
      updated_at: issue.updatedAt ?? null,
      state: issue.state
        ? {
          id: issue.state.id ?? null,
          name: issue.state.name ?? null,
          type: issue.state.type ?? null,
        }
        : null,
      assignee: issue.assignee
        ? {
          id: issue.assignee.id ?? null,
          name: issue.assignee.displayName ?? issue.assignee.name ?? null,
        }
        : null,
      team: issue.team
        ? {
          id: issue.team.id ?? null,
          key: issue.team.key ?? null,
          name: issue.team.name ?? null,
        }
        : null,
    },
  };
}

async function readIssueComments(
  client: LinearActivityClient,
  issueId: string,
  limit: number,
): Promise<unknown> {
  if (typeof client.issue !== "function") {
    throw new Error("linear_list_issue_comments is unavailable: Linear client does not support issue().");
  }

  const issue = await client.issue(issueId) as {
    comments?: () => Promise<{ nodes?: Array<{
      id?: string | null;
      body?: string | null;
      createdAt?: string | null;
      updatedAt?: string | null;
      user?: { id?: string | null; name?: string | null; displayName?: string | null } | null;
    }> }>;
  };

  if (typeof issue.comments !== "function") {
    throw new Error("linear_list_issue_comments is unavailable: issue.comments() is not supported by the Linear client.");
  }

  const response = await issue.comments();
  const comments = (response.nodes ?? [])
    .slice(-limit)
    .map((comment) => ({
      id: comment.id ?? null,
      body: comment.body ?? null,
      created_at: comment.createdAt ?? null,
      updated_at: comment.updatedAt ?? null,
      user: comment.user
        ? {
          id: comment.user.id ?? null,
          name: comment.user.displayName ?? comment.user.name ?? null,
        }
        : null,
    }));

  return { comments };
}

async function readIssueTeamId(
  client: LinearActivityClient,
  issueId: string | undefined,
): Promise<string | null> {
  if (!issueId) {
    return null;
  }

  if (typeof client.issue !== "function") {
    throw new Error("linear_list_workflow_states is unavailable: Linear client does not support issue().");
  }

  const issue = await client.issue(issueId) as {
    teamId?: string | null;
    team?: { id?: string | null } | null;
  };

  return issue.teamId ?? issue.team?.id ?? null;
}

async function readWorkflowStates(
  client: LinearActivityClient,
  teamId: string,
): Promise<unknown> {
  if (typeof client.workflowStates !== "function") {
    throw new Error(
      "linear_list_workflow_states is unavailable: Linear client does not support workflowStates().",
    );
  }

  const response = await client.workflowStates({ teamId }) as {
    nodes?: Array<{
      id?: string | null;
      name?: string | null;
      type?: string | null;
      position?: number | null;
      teamId?: string | null;
    }>;
  };

  const states = (response.nodes ?? [])
    .map((state) => ({
      id: state.id ?? null,
      name: state.name ?? null,
      type: state.type ?? null,
      position: state.position ?? null,
      team_id: state.teamId ?? teamId,
    }))
    .sort((left, right) => (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER));

  return { team_id: teamId, states };
}

function extractRepositorySuggestions(response: unknown): RepositorySuggestion[] {
  if (response == null || typeof response !== "object") {
    return [];
  }

  const payload = response as { suggestions?: unknown };
  if (!Array.isArray(payload.suggestions)) {
    return [];
  }

  return payload.suggestions
    .filter((entry): entry is Record<string, unknown> =>
      entry != null && typeof entry === "object" && typeof (entry as Record<string, unknown>).repositoryFullName === "string",
    )
    .map((entry) => ({
      repositoryFullName: entry.repositoryFullName as string,
      hostname: typeof entry.hostname === "string" ? entry.hostname : null,
      confidence: typeof entry.confidence === "number" ? entry.confidence : 0,
    }));
}
