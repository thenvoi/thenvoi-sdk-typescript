import { LinearDocument as L } from "@linear/sdk";

/**
 * Subset of `LinearClient` covering only the activity-reporting methods.
 */
export interface LinearActivityClient {
  createAgentActivity(input: {
    agentSessionId: string;
    content: Record<string, unknown>;
    ephemeral?: boolean;
  }): Promise<unknown>;
  updateAgentSession?: (
    id: string,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  updateIssue?: (
    issueId: string,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  createComment?: (
    input: { issueId: string; body: string },
  ) => Promise<unknown>;
  issue?: (issueId: string) => Promise<unknown>;
  workflowStates?: (variables?: Record<string, unknown>) => Promise<unknown>;
}

export interface PlanStep {
  title: string;
  status: "pending" | "in_progress" | "completed" | "failed";
}

async function postActivity(
  client: LinearActivityClient,
  sessionId: string,
  content: Record<string, unknown>,
  options?: { ephemeral?: boolean },
): Promise<void> {
  await client.createAgentActivity({
    agentSessionId: sessionId,
    content,
    ...(options?.ephemeral ? { ephemeral: true } : {}),
  });
}

async function postBodyActivity(
  client: LinearActivityClient,
  sessionId: string,
  type: L.AgentActivityType,
  body: string,
  options?: { ephemeral?: boolean },
): Promise<void> {
  await postActivity(client, sessionId, { type, body }, options);
}

export async function postThought(
  client: LinearActivityClient,
  sessionId: string,
  body: string,
  options?: { ephemeral?: boolean },
): Promise<void> {
  await postBodyActivity(client, sessionId, L.AgentActivityType.Thought, body, options);
}

export async function postError(
  client: LinearActivityClient,
  sessionId: string,
  body: string,
): Promise<void> {
  await postBodyActivity(client, sessionId, L.AgentActivityType.Error, body);
}

export async function postResponse(
  client: LinearActivityClient,
  sessionId: string,
  body: string,
): Promise<void> {
  await postBodyActivity(client, sessionId, L.AgentActivityType.Response, body);
}

export async function postElicitation(
  client: LinearActivityClient,
  sessionId: string,
  body: string,
): Promise<void> {
  await postBodyActivity(client, sessionId, L.AgentActivityType.Elicitation, body);
}

export async function postAction(
  client: LinearActivityClient,
  sessionId: string,
  body: string,
  options?: { ephemeral?: boolean },
): Promise<void> {
  await postActivity(client, sessionId, {
    type: L.AgentActivityType.Action,
    action: body,
    parameter: "",
  }, options);
}

type LinearPlanStatus = "pending" | "inProgress" | "completed" | "canceled";

const PLAN_STATUS_MAP: Record<PlanStep["status"], LinearPlanStatus> = {
  pending: "pending",
  in_progress: "inProgress",
  completed: "completed",
  failed: "canceled",
};

export async function updatePlan(
  client: LinearActivityClient,
  sessionId: string,
  steps: PlanStep[],
): Promise<void> {
  if (typeof client.updateAgentSession === "function") {
    const plan = {
      steps: steps.map((step) => ({
        content: step.title,
        status: PLAN_STATUS_MAP[step.status],
      })),
    };

    try {
      await client.updateAgentSession(sessionId, { plan });
      return;
    } catch (err) {
      console.warn("updateAgentSession failed, falling back to legacy plan", err);
    }
  }

  const planSummary = steps
    .map((step) => {
      const icon =
        step.status === "completed" ? "\u2705" :
        step.status === "in_progress" ? "\u23f3" :
        step.status === "failed" ? "\u274c" :
        "\u2b1c";
      return `${icon} ${step.title}`;
    })
    .join("\n");

  await postActivity(client, sessionId, {
    type: L.AgentActivityType.Thought,
    body: `**Plan:**\n${planSummary}`,
  });
}
