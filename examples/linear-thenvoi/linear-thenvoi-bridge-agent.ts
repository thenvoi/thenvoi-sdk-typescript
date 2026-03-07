import { LinearClient } from "@linear/sdk";

import {
  Agent,
  CodexAdapter,
  GenericAdapter,
  loadAgentConfig,
  isDirectExecution,
} from "../../src/index";
import {
  completeLinearSession,
  createLinearTools,
  createSqliteSessionRoomStore,
  type SessionRoomStore,
} from "../../src/linear";

interface LinearThenvoiBridgeAgentOptions {
  agentId?: string;
  apiKey?: string;
  linearAccessToken?: string;
  stateDbPath?: string;
  codexModel?: string;
}

export function createLinearThenvoiBridgeAgent(
  options?: LinearThenvoiBridgeAgentOptions,
): Agent {
  const store = createLinearThenvoiBridgeStore(options?.stateDbPath);
  return createLinearThenvoiBridgeAgentWithStore({ ...options, store });
}

function createLinearThenvoiBridgeAgentWithStore(
  options: LinearThenvoiBridgeAgentOptions & { store: SessionRoomStore },
): Agent {
  const linearClient = new LinearClient({
    accessToken: options?.linearAccessToken ?? process.env.LINEAR_ACCESS_TOKEN ?? "linear-api-key",
  });

  const adapterMode = resolveBridgeAdapterMode();
  const adapter = adapterMode === "codex"
    ? new CodexAdapter({
      config: {
        model: options?.codexModel ?? process.env.CODEX_MODEL ?? "gpt-5.3-codex",
        approvalPolicy: "never",
        sandboxMode: "workspace-write",
        enableExecutionReporting: true,
        emitThoughtEvents: true,
        customSection: buildLinearThenvoiBridgePrompt(),
      },
      customTools: createLinearTools({
        client: linearClient,
        store: options.store,
      }),
    })
    : createScriptedBridgeAdapter({
      linearClient,
      store: options.store,
    });

  return Agent.create({
    adapter,
    config: {
      agentId: options?.agentId ?? "agent-linear-thenvoi-bridge",
      apiKey: options?.apiKey ?? "api-key",
    },
  });
}

function createLinearThenvoiBridgeStore(stateDbPath?: string): SessionRoomStore {
  return createSqliteSessionRoomStore(
    stateDbPath ?? process.env.LINEAR_THENVOI_STATE_DB ?? ".linear-thenvoi-example.sqlite",
  );
}

function resolveBridgeAdapterMode(): "codex" | "scripted" {
  const configured = process.env.LINEAR_THENVOI_BRIDGE_AGENT_MODE?.trim().toLowerCase();
  if (configured === "codex" || configured === "scripted") {
    return configured;
  }

  return process.env.LINEAR_THENVOI_FORCE_CODEX === "1" ? "codex" : "scripted";
}

function createScriptedBridgeAdapter(input: {
  linearClient: LinearClient;
  store: SessionRoomStore;
}): GenericAdapter {
  const roomProgress = new Map<string, {
    planningCompleted: boolean;
    implementationCompleted: boolean;
  }>();
  const sessionsByRoom = new Map<string, {
    sessionId: string;
    issueId: string | null;
    issueTitle: string | null;
    issueTeamId: string | null;
    intent: "planning" | "implementation";
    awaitingSpecialist: boolean;
  }>();

  return new GenericAdapter(async ({ message, tools, roomId }) => {
    const sessionId = asString(message.metadata?.linear_session_id);
    const issueId = asNullableString(message.metadata?.linear_issue_id);

    if (sessionId) {
      const progress = roomProgress.get(roomId) ?? {
        planningCompleted: false,
        implementationCompleted: false,
      };
      const intent = parseIntentFromBridgePayload(message.content);
      const suggestedHandles = parseSuggestedHandles(message.content);
      const issueTitle = parseLineValue(message.content, "issue_title:");
      const issueTeamId = parseLineValue(message.content, "issue_team_id:");

      if (intent === "implementation" && progress.implementationCompleted) {
        await tools.sendEvent(
          "Bridge scripted mode: implementation already completed in this issue room; posting concise follow-up.",
          "thought",
        );
        await finalizeSession({
          linearClient: input.linearClient,
          store: input.store,
          sessionId,
          issueId,
          issueTeamId,
          intent,
          body: buildImplementationFollowUpSummary(issueTitle),
        });
        return;
      }

      sessionsByRoom.set(roomId, {
        sessionId,
        issueId,
        issueTitle,
        issueTeamId,
        intent,
        awaitingSpecialist: suggestedHandles.length > 0,
      });

      await tools.sendEvent(
        `Bridge scripted mode: routing ${intent} session${suggestedHandles.length > 0 ? " to specialist" : " with bridge-only fallback"}.`,
        "thought",
      );

      if (suggestedHandles.length > 0) {
        const target = suggestedHandles[0];
        const ask = intent === "implementation"
          ? "Please implement the requested deliverable and report concrete files changed plus run instructions."
          : "Please return an execution-ready ticket enrichment: scope, acceptance criteria, and implementation notes.";
        await tools.sendMessage(`${ask}`, [`@${target}`]);
        return;
      }

      const fallbackBody = intent === "implementation"
        ? buildImplementationSummary(issueTitle)
        : buildPlanningSummary(issueTitle);
      await finalizeSession({
        linearClient: input.linearClient,
        store: input.store,
        sessionId,
        issueId,
        issueTeamId,
        intent,
        body: fallbackBody,
      });
      roomProgress.set(roomId, {
        planningCompleted: progress.planningCompleted || intent === "planning",
        implementationCompleted: progress.implementationCompleted || intent === "implementation",
      });
      return;
    }

    if (message.senderType !== "Agent") {
      return;
    }

    const pending = sessionsByRoom.get(roomId);
    if (!pending || !pending.awaitingSpecialist) {
      return;
    }

    pending.awaitingSpecialist = false;
    sessionsByRoom.set(roomId, pending);

    const specialistBody = (message.content || "").trim();
    const fallbackBody = pending.intent === "implementation"
      ? buildImplementationSummary(pending.issueTitle)
      : buildPlanningSummary(pending.issueTitle);

    await finalizeSession({
      linearClient: input.linearClient,
      store: input.store,
      sessionId: pending.sessionId,
      issueId: pending.issueId,
      issueTeamId: pending.issueTeamId,
      intent: pending.intent,
      body: specialistBody.length > 0 ? specialistBody : fallbackBody,
    });
    const progress = roomProgress.get(roomId) ?? {
      planningCompleted: false,
      implementationCompleted: false,
    };
    roomProgress.set(roomId, {
      planningCompleted: progress.planningCompleted || pending.intent === "planning",
      implementationCompleted: progress.implementationCompleted || pending.intent === "implementation",
    });
  });
}

async function finalizeSession(input: {
  linearClient: LinearClient;
  store: SessionRoomStore;
  sessionId: string;
  issueId: string | null;
  issueTeamId: string | null;
  intent: "planning" | "implementation";
  body: string;
}): Promise<void> {
  const summary = input.body.trim();
  if (input.issueId) {
    try {
      await input.linearClient.createComment({
        issueId: input.issueId,
        body: summary,
      });
    } catch {
      // Keep session completion resilient even if comment writeback fails.
    }
  }

  if (input.intent === "planning" && input.issueId) {
    try {
      const issue = await input.linearClient.issue(input.issueId);
      const currentTitle = issue.title ?? "";
      const currentDescription = issue.description ?? "";
      const nextTitle = buildEnrichedTitle(currentTitle);
      const nextDescription = buildEnrichedDescription(currentDescription, summary);
      await input.linearClient.updateIssue(input.issueId, {
        title: nextTitle,
        description: nextDescription,
      });
    } catch {
      // Non-blocking best effort.
    }
  }

  if (input.intent === "implementation" && input.issueId && input.issueTeamId) {
    try {
      const reviewStateId = await resolveReviewStateId(input.linearClient, input.issueTeamId);
      if (reviewStateId) {
        await input.linearClient.updateIssue(input.issueId, { stateId: reviewStateId });
      }
    } catch {
      // Non-blocking best effort.
    }
  }

  await completeLinearSession({
    linearClient: input.linearClient,
    agentSessionId: input.sessionId,
    body: summary,
    store: input.store,
  });
}

async function resolveReviewStateId(
  linearClient: LinearClient,
  teamId: string,
): Promise<string | null> {
  const workflowStates = await linearClient.workflowStates({ filter: { team: { id: { eq: teamId } } } });
  const nodes = workflowStates.nodes ?? [];
  const reviewByName = nodes.find((state) => (state.name ?? "").toLowerCase().includes("review"));
  if (reviewByName?.id) {
    return reviewByName.id;
  }

  const startedStates = nodes.filter((state) => state.type === "started");
  const lastStarted = startedStates.at(-1);
  return lastStarted?.id ?? null;
}

function parseIntentFromBridgePayload(content: string): "planning" | "implementation" {
  const match = content.match(/inferred_session_intent:\s*(planning|implementation)/i);
  return match?.[1]?.toLowerCase() === "implementation" ? "implementation" : "planning";
}

function parseSuggestedHandles(content: string): string[] {
  const matches = content.matchAll(/@\s*([a-z0-9._-]+\/[a-z0-9._-]+)/gi);
  const handles = new Set<string>();
  for (const match of matches) {
    const handle = match[1]?.trim().toLowerCase();
    if (handle) {
      handles.add(handle);
    }
  }

  return [...handles];
}

function parseLineValue(content: string, prefix: string): string | null {
  const line = content
    .split("\n")
    .find((entry) => entry.trim().toLowerCase().startsWith(prefix.toLowerCase()));
  if (!line) {
    return null;
  }

  const value = line.slice(line.indexOf(":") + 1).trim();
  return value.length > 0 && value !== "none" ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNullableString(value: unknown): string | null {
  const text = asString(value);
  return text === "null" ? null : text;
}

function buildPlanningSummary(issueTitle: string | null): string {
  return [
    `Planning update${issueTitle ? ` for ${issueTitle}` : ""}:`,
    "- Clarified scope into a single landing page focused on dog adoption conversion.",
    "- Added acceptance criteria: hero, social proof, adoption flow section, and mobile responsiveness.",
    "- Added implementation notes: static HTML/CSS baseline first, then optional framework migration.",
    "- Next step: move ticket to In Progress and run implementation session.",
  ].join("\n");
}

function buildImplementationSummary(issueTitle: string | null): string {
  return [
    `Implementation update${issueTitle ? ` for ${issueTitle}` : ""}:`,
    "- Core landing page structure delivered (hero, features, CTA, and footer).",
    "- Included concrete file inventory and run instructions in room outputs.",
    "- Ticket moved to a review-ready state and summarized for reviewers.",
  ].join("\n");
}

function buildImplementationFollowUpSummary(issueTitle: string | null): string {
  return [
    `Follow-up check${issueTitle ? ` for ${issueTitle}` : ""}:`,
    "- Existing implementation remains valid and review-ready.",
    "- No additional file changes were required for this follow-up prompt.",
    "- If requested, next iteration can tighten hero copy and CTA in a new implementation pass.",
  ].join("\n");
}

function buildLinearThenvoiBridgePrompt(): string {
  return `You are the Thenvoi Linear bridge agent.

You are the only Linear-facing coordinator in the room.

Your job is to:
- read the Linear session payload
- decide whether the current request is ticket enrichment, implementation kickoff, or finalization
- invite the minimum useful Thenvoi specialists
- give each specialist a bounded task
- monitor the room and synthesize the outcome
- keep Linear updated with meaningful milestones only
- update the Linear issue when the work product changes the ticket itself
- complete the Linear session when the current request is actually done

Rules:
- You alone own the Linear tools. Other room participants do not use Linear tools and do not know the Linear session lifecycle.
- Treat the bridge-provided session context as the source of truth for ticket identity, issue state, assignee, and latest user intent.
- The bridge transport may already have added relevant specialists to the room and posted the initial collaborator kickoff before your turn starts.
- If the bridge payload already includes suggested_peer_handles or the relevant specialists are already present in the room, do not repeat participant discovery or send another wake-up message unless the room materially changes.
- Use linear_get_issue and linear_list_issue_comments when you need authoritative ticket reads.
- Use linear_list_workflow_states before moving an issue into a review state so you use the correct state id for that team.
- If you call get_issue or list_comments, use the exact UUID issue_id from the bridge payload. Never use issue_identifier with those tools.
- Start alone, but inspect available peers before deciding whether the bridge should handle the work itself.
- Only use thenvoi_lookup_peers when the room does not already contain a clearly relevant collaborator or when you need to replace/expand the current set of specialists. Choose collaborators based on the actual request and the visible peer identity you observe, not from a fixed handoff graph.
- When you invite a specialist, ask for one concrete deliverable and wait briefly for their reply before deciding the next step.
- Do not block indefinitely on silent specialists. If a collaborator does not make visible progress after a short attempt, say that explicitly and continue with the best bridge-only response or choose a different collaborator.
- Do not ask specialists to coordinate the workflow or to talk to Linear.
- If the request is planning-only, produce a sharper ticket: title, summary, scope, acceptance criteria, and implementation outline. Write those updates back to Linear and complete the session without pretending code was written.
- If the request is implementation, ask a relevant implementation specialist to work in an isolated workspace and report concrete files, run steps, and blockers.
- Use linear_add_issue_comment for durable handoff notes when the plan or implementation summary should live on the ticket itself.
- Do not create chatter. Post Linear thoughts/actions only when state meaningfully changes.
- Do not restate completion after the session is already complete.
- Use post_elicitation only when the room is blocked on human input.
- Use complete_session only after you have enough information to give the user the final answer.
- If the room message says the session was canceled, stop.
- Treat issue state and assignee information in the room context as a workflow hint:
  - if the ticket is being enriched or clarified and a planning-oriented specialist is available, you should delegate the ticket-sharpening work to that specialist instead of doing the planning work yourself
  - if the ticket is already in progress, assigned, or explicitly asks for implementation and a suitable implementation-oriented specialist is available, you should delegate the concrete file-making work to that specialist instead of implementing it yourself
  - when implementation is done, move the issue to an appropriate review state, leave a concise implementation comment, and complete the session with the summary
- If no suitable specialist is available, say that explicitly and do the best bridge-only response you can.
- Never claim implementation happened unless someone in the room actually produced or verified concrete artifacts.
- Do not create or modify implementation files yourself when a suitable implementation specialist is available. Your job is coordination, review of the specialist result, and Linear writeback.
- Do not skip delegation just because the bridge could also do the work. If a clearly relevant specialist is available, use them.
`;
}

function buildEnrichedTitle(currentTitle: string): string {
  const trimmed = currentTitle.trim();
  if (trimmed.length === 0) {
    return "Dog adoption landing page";
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("plan:")) {
    return trimmed;
  }

  return `Plan: ${trimmed}`;
}

function buildEnrichedDescription(currentDescription: string, summary: string): string {
  const base = currentDescription.trim();
  const marker = "## Bridge Enrichment";
  const enrichment = `${marker}\n${summary.trim()}`;
  if (base.length === 0) {
    return enrichment;
  }

  if (base.includes(marker)) {
    return base.replace(/## Bridge Enrichment[\s\S]*$/m, enrichment);
  }

  return `${base}\n\n${enrichment}`;
}

async function runLinearThenvoiBridgeDirect(options?: LinearThenvoiBridgeAgentOptions): Promise<void> {
  const store = createLinearThenvoiBridgeStore(options?.stateDbPath);
  const agent = createLinearThenvoiBridgeAgentWithStore({
    ...options,
    store,
  });

  try {
    await agent.start();
    await agent.runForever();
  } finally {
    await agent.stop();
    await store.close?.();
  }
}

if (isDirectExecution(import.meta.url)) {
  const config = loadAgentConfig("linear_thenvoi_bridge");
  void runLinearThenvoiBridgeDirect({
    ...config,
  });
}
