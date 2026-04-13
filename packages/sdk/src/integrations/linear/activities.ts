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

async function postActivity(
  client: LinearActivityClient,
  sessionId: string,
  content: Record<string, unknown>,
): Promise<void> {
  await client.createAgentActivity({
    agentSessionId: sessionId,
    content,
  });
}

async function postBodyActivity(
  client: LinearActivityClient,
  sessionId: string,
  type: L.AgentActivityType,
  body: string,
): Promise<void> {
  await postActivity(client, sessionId, { type, body });
}

export async function postThought(
  client: LinearActivityClient,
  sessionId: string,
  body: string,
): Promise<void> {
  await postBodyActivity(client, sessionId, L.AgentActivityType.Thought, body);
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

export interface SelectOption {
  label: string;
  value: string;
}

/** Longest label or value string allowed in a select option. */
export const SELECT_OPTION_MAX_LENGTH = 200;

export async function postSelectElicitation(
  client: LinearActivityClient,
  sessionId: string,
  body: string,
  options: SelectOption[],
): Promise<void> {
  await postActivity(client, sessionId, {
    type: L.AgentActivityType.Elicitation,
    body,
    signal: L.AgentActivitySignal.Select,
    signalMetadata: { options },
  });
}

export async function postAuthElicitation(
  client: LinearActivityClient,
  sessionId: string,
  body: string,
  url: string,
  provider?: string,
): Promise<void> {
  await postActivity(client, sessionId, {
    type: L.AgentActivityType.Elicitation,
    body,
    signal: L.AgentActivitySignal.Auth,
    signalMetadata: {
      url,
      ...(provider ? { provider } : {}),
    },
  });
}

export async function postAction(
  client: LinearActivityClient,
  sessionId: string,
  body: string,
): Promise<void> {
  await postActivity(client, sessionId, {
    type: L.AgentActivityType.Action,
    action: body,
    parameter: "",
  });
}
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

  await postActivity(client, sessionId, {
    type: L.AgentActivityType.Thought,
    body: `**Plan:**\n${planSummary}`,
  });
}
