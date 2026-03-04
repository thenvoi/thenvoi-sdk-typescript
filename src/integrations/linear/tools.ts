import { z } from "zod";

import type { CustomToolDef } from "../../runtime/tools/customTools";
import type { LinearActivityClient, PlanStep } from "./activities";
import {
  postThought,
  postAction,
  postError,
  postResponse,
  postElicitation,
  updatePlan,
} from "./activities";

export interface CreateLinearToolsOptions {
  client: LinearActivityClient;
}

/**
 * Create Linear activity tools usable by any adapter via `customTools`.
 */
export function createLinearTools(options: CreateLinearToolsOptions): CustomToolDef[] {
  const { client } = options;

  const sessionBodySchema = z.object({
    session_id: z.string().describe("The Linear agent session ID"),
    body: z.string().describe("The message body in Markdown format"),
  });

  return [
    {
      name: "linear_post_thought",
      description: "Post a thought to the Linear agent session, visible to the user as internal reasoning.",
      schema: sessionBodySchema,
      handler: async (args: Record<string, unknown>) => {
        await postThought(client, args.session_id as string, args.body as string);
        return { ok: true };
      },
    },
    {
      name: "linear_post_action",
      description: "Post an action to the Linear agent session, showing the user what step is being taken.",
      schema: sessionBodySchema,
      handler: async (args: Record<string, unknown>) => {
        await postAction(client, args.session_id as string, args.body as string);
        return { ok: true };
      },
    },
    {
      name: "linear_post_error",
      description: "Post an error to the Linear agent session to notify the user of a failure.",
      schema: sessionBodySchema,
      handler: async (args: Record<string, unknown>) => {
        await postError(client, args.session_id as string, args.body as string);
        return { ok: true };
      },
    },
    {
      name: "linear_post_response",
      description: "Post a response to the Linear agent session as the agent's answer.",
      schema: sessionBodySchema,
      handler: async (args: Record<string, unknown>) => {
        await postResponse(client, args.session_id as string, args.body as string);
        return { ok: true };
      },
    },
    {
      name: "linear_ask_user",
      description: "Ask the Linear user a question via an elicitation activity.",
      schema: sessionBodySchema,
      handler: async (args: Record<string, unknown>) => {
        await postElicitation(client, args.session_id as string, args.body as string);
        return { ok: true };
      },
    },
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
  ];
}
