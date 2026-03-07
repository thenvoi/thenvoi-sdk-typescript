import { LinearDocument as L } from "@linear/sdk";

/**
 * Subset of `LinearClient` covering only the activity-reporting methods.
 */
export interface LinearActivityClient {
  createAgentActivity(input: {
    agentSessionId: string;
    content: Record<string, unknown>;
  }): Promise<unknown>;
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

/** Post a thought activity to a Linear agent session. */
export async function postThought(
  client: LinearActivityClient,
  sessionId: string,
  body: string,
): Promise<void> {
  await client.createAgentActivity({
    agentSessionId: sessionId,
    content: { type: L.AgentActivityType.Thought, body },
  });
}

/** Post an action activity to a Linear agent session. */
export async function postAction(
  client: LinearActivityClient,
  sessionId: string,
  body: string,
): Promise<void> {
  await client.createAgentActivity({
    agentSessionId: sessionId,
    content: {
      type: L.AgentActivityType.Action,
      action: body,
      parameter: "",
    },
  });
}

/** Post an error activity to a Linear agent session. */
export async function postError(
  client: LinearActivityClient,
  sessionId: string,
  body: string,
): Promise<void> {
  await client.createAgentActivity({
    agentSessionId: sessionId,
    content: { type: L.AgentActivityType.Error, body },
  });
}

/** Post a response activity to a Linear agent session. */
export async function postResponse(
  client: LinearActivityClient,
  sessionId: string,
  body: string,
): Promise<void> {
  await client.createAgentActivity({
    agentSessionId: sessionId,
    content: { type: L.AgentActivityType.Response, body },
  });
}

/** Post an elicitation (user question) activity to a Linear agent session. */
export async function postElicitation(
  client: LinearActivityClient,
  sessionId: string,
  body: string,
): Promise<void> {
  await client.createAgentActivity({
    agentSessionId: sessionId,
    content: { type: L.AgentActivityType.Elicitation, body },
  });
}

/** Update the visible plan steps for a Linear agent session. */
export async function updatePlan(
  client: LinearActivityClient,
  sessionId: string,
  steps: PlanStep[],
): Promise<void> {
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

  await client.createAgentActivity({
    agentSessionId: sessionId,
    content: {
      type: L.AgentActivityType.Thought,
      body: `**Plan:**\n${planSummary}`,
    },
  });
}
