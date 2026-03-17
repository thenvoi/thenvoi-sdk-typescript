import { LinearClient } from "@linear/sdk";
import type { FrameworkAdapter, FrameworkAdapterInput } from "../../src/contracts/protocols";

import {
  Agent,
  CodexAdapter,
  GenericAdapter,
  loadAgentConfig,
  isDirectExecution,
} from "../../src/index";
import {
  completeLinearSession,
  createLinearClient,
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
  name?: string;
  description?: string | null;
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
  const linearClient = createLinearClient(
    options?.linearAccessToken ?? process.env.LINEAR_ACCESS_TOKEN ?? "linear-api-key",
  );

  const adapterMode = resolveBridgeAdapterMode();
  const adapter = adapterMode === "codex"
    ? createCodexBridgeAdapterWithTimeoutFallback({
      codexAdapter: new CodexAdapter({
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
          enableElicitation: resolveBridgeElicitationEnabled(),
        }),
      }),
      linearClient,
      store: options.store,
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
    identity: {
      name: options?.name ?? "Thenvoi Linear Bridge",
      description: options?.description ?? "Linear bridge agent coordinating Thenvoi specialists",
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

  return "codex";
}

function resolveBridgeElicitationEnabled(): boolean {
  return process.env.LINEAR_THENVOI_ALLOW_ELICITATION === "1";
}

function resolveBridgeCodexSessionTimeoutMs(): number | null {
  const raw = process.env.LINEAR_THENVOI_CODEX_SESSION_TIMEOUT_MS?.trim();
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 5_000) {
    return null;
  }
  return parsed;
}

function createCodexBridgeAdapterWithTimeoutFallback(input: {
  codexAdapter: CodexAdapter;
  linearClient: LinearClient;
  store: SessionRoomStore;
}): FrameworkAdapter {
  const timeoutMs = resolveBridgeCodexSessionTimeoutMs();

  return {
    onStarted: async (agentName: string, agentDescription: string): Promise<void> => {
      await input.codexAdapter.onStarted(agentName, agentDescription);
    },
    onCleanup: async (roomId: string): Promise<void> => {
      await input.codexAdapter.onCleanup(roomId);
    },
    onEvent: async (event: FrameworkAdapterInput): Promise<void> => {
      const sessionId = asString(event.message.metadata?.linear_session_id);
      if (!sessionId) {
        await input.codexAdapter.onEvent(event);
        return;
      }

      const issueId = asNullableString(event.message.metadata?.linear_issue_id);
      const issueTitle = parseLineValue(event.message.content, "issue_title:");
      const issueTeamId = parseLineValue(event.message.content, "issue_team_id:");
      const intent = parseIntentFromBridgePayload(event.message.content);

      if (timeoutMs === null) {
        await input.codexAdapter.onEvent(event);
        return;
      }

      let timer: NodeJS.Timeout | null = null;
      try {
        await Promise.race([
          input.codexAdapter.onEvent(event),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error("linear_thenvoi_bridge.codex_timeout"));
            }, timeoutMs);
          }),
        ]);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "linear_thenvoi_bridge.codex_timeout") {
          throw error;
        }

        const body = intent === "implementation"
          ? buildImplementationTimeoutSummary(issueTitle)
          : buildPlanningTimeoutSummary(issueTitle);
        await finalizeSession({
          linearClient: input.linearClient,
          store: input.store,
          sessionId,
          issueId,
          issueTeamId,
          intent,
          body,
        });
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    },
  };
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
    awaitingRole: "planner" | "reviewer" | "implementer" | null;
    plannerHandle: string | null;
    reviewerHandle: string | null;
    implementerHandle: string | null;
    plannerDraft: string | null;
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
      const plannerHandle = findSuggestedHandle(suggestedHandles, "planner");
      const reviewerHandle = findSuggestedHandle(suggestedHandles, "reviewer");
      const implementerHandle = findSuggestedHandle(suggestedHandles, "implementer");
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
        awaitingSpecialist: intent === "implementation"
          ? implementerHandle !== null
          : plannerHandle !== null || reviewerHandle !== null,
        awaitingRole: intent === "implementation"
          ? (implementerHandle ? "implementer" : null)
          : (plannerHandle ? "planner" : reviewerHandle ? "reviewer" : null),
        plannerHandle,
        reviewerHandle,
        implementerHandle,
        plannerDraft: null,
      });

      await tools.sendEvent(
        `Bridge scripted mode: routing ${intent} session${suggestedHandles.length > 0 ? " to specialist" : " with bridge-only fallback"}.`,
        "thought",
      );

      if (intent === "planning") {
        const planningTarget = plannerHandle ?? reviewerHandle;
        if (planningTarget) {
          await ensureParticipantInRoomByHandle(tools, planningTarget);
          const ask = plannerHandle
            ? "Please draft an implementation plan for this Linear request. Return scope, acceptance criteria, sequencing, and verification."
            : "Please review the implementation plan for this Linear request and return a bridge-ready execution plan.";
          await tools.sendMessage(ask, [`@${planningTarget}`]);
          return;
        }
      }

      if (intent === "implementation" && implementerHandle) {
        await ensureParticipantInRoomByHandle(tools, implementerHandle);
        await tools.sendMessage(
          "Please implement the requested deliverable and report concrete files changed plus run instructions.",
          [`@${implementerHandle}`],
        );
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

    const specialistBody = (message.content || "").trim();
    if (pending.intent === "planning" && pending.awaitingRole === "planner" && pending.reviewerHandle) {
      pending.awaitingRole = "reviewer";
      pending.plannerDraft = specialistBody.length > 0 ? specialistBody : null;
      sessionsByRoom.set(roomId, pending);
      await tools.sendEvent(
        "Bridge scripted mode: planner returned a draft, asking the reviewer to tighten it.",
        "thought",
      );
      await ensureParticipantInRoomByHandle(tools, pending.reviewerHandle);
      const reviewPrompt = [
        "Please review the implementation plan below and return a tightened version the bridge can post back to Linear.",
        "",
        pending.plannerDraft ?? "No planner draft was returned.",
      ].join("\n");
      await tools.sendMessage(reviewPrompt, [`@${pending.reviewerHandle}`]);
      return;
    }

    pending.awaitingSpecialist = false;
    pending.awaitingRole = null;
    sessionsByRoom.set(roomId, pending);

    const fallbackBody = pending.intent === "implementation"
      ? buildImplementationSummary(pending.issueTitle)
      : buildPlanningSummary(pending.issueTitle);
    const finalPlanningBody = pending.intent === "planning"
      ? buildReviewedPlanningSummary({
        issueTitle: pending.issueTitle,
        plannerDraft: pending.plannerDraft,
        reviewerDraft: specialistBody,
      })
      : null;

    await finalizeSession({
      linearClient: input.linearClient,
      store: input.store,
      sessionId: pending.sessionId,
      issueId: pending.issueId,
      issueTeamId: pending.issueTeamId,
      intent: pending.intent,
      body: pending.intent === "planning"
        ? finalPlanningBody ?? fallbackBody
        : specialistBody.length > 0 ? specialistBody : fallbackBody,
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

function findSuggestedHandle(
  handles: string[],
  kind: "planner" | "reviewer" | "implementer",
): string | null {
  const patterns = kind === "planner"
    ? [/\bplanner\b/, /\bclaude\b/]
    : kind === "reviewer"
      ? [/\breviewer\b/, /\breview\b/, /\bcodex\b/]
      : [/\bimplementer\b/, /\bcoder\b/, /\bengineer\b/, /\bdeveloper\b/];

  return handles.find((handle) => patterns.some((pattern) => pattern.test(handle))) ?? null;
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

async function ensureParticipantInRoomByHandle(
  tools: {
    addParticipant(name: string, role?: string): Promise<unknown>;
    lookupPeers?: (page?: number, pageSize?: number) => Promise<{
      data?: Array<{ handle?: string | null; name?: string | null }>;
      metadata?: { totalPages?: number };
    }>;
  },
  handle: string,
): Promise<void> {
  if (typeof tools.lookupPeers !== "function") {
    throw new Error("Bridge scripted mode requires peer lookup support to add participants by handle.");
  }

  const normalizedHandle = handle.trim().replace(/^@+/, "").toLowerCase();
  const pageSize = 100;
  const maxPages = 10;

  for (let page = 1; page <= maxPages; page += 1) {
    const peers = await tools.lookupPeers(page, pageSize);
    const items = peers.data ?? [];
    const match = items.find((peer) => {
      const peerHandle = typeof peer.handle === "string"
        ? peer.handle.trim().replace(/^@+/, "").toLowerCase()
        : "";
      return peerHandle === normalizedHandle;
    });
    if (match?.name) {
      await tools.addParticipant(match.name, "member");
      return;
    }

    const totalPages = peers.metadata?.totalPages;
    if (typeof totalPages === "number" && page >= totalPages) {
      break;
    }
    if (items.length < pageSize) {
      break;
    }
  }

  throw new Error(`Bridge scripted mode could not find specialist handle '${handle}'.`);
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
    "- Register Claude Code and Codex as standard Thenvoi agents and keep the bridge as the only Linear-aware participant.",
    "- Reuse the existing isolated sandbox and git-ready specialist workspaces for planner and reviewer execution.",
    "- Post the reviewed implementation plan back to Linear as thought, action, and final response activities.",
    "- Next step: validate the tagged-issue flow against a real Linear session.",
  ].join("\n");
}

function buildReviewedPlanningSummary(input: {
  issueTitle: string | null;
  plannerDraft: string | null;
  reviewerDraft: string;
}): string | null {
  const reviewed = input.reviewerDraft.trim();
  if (reviewed.length > 0) {
    return reviewed;
  }

  const planner = input.plannerDraft?.trim() ?? "";
  if (planner.length > 0) {
    return [
      `Reviewed implementation plan${input.issueTitle ? ` for ${input.issueTitle}` : ""}:`,
      planner,
    ].join("\n\n");
  }

  return null;
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

function buildPlanningTimeoutSummary(issueTitle: string | null): string {
  return [
    `Planning fallback${issueTitle ? ` for ${issueTitle}` : ""}:`,
    "- The bridge timed out waiting for extended collaborator interaction.",
    "- Posted a conservative execution-ready baseline so work can continue asynchronously.",
    "- You can rerun enrichment for deeper detail after collaborators are responsive.",
  ].join("\n");
}

function buildImplementationTimeoutSummary(issueTitle: string | null): string {
  return [
    `Implementation fallback${issueTitle ? ` for ${issueTitle}` : ""}:`,
    "- The bridge timed out waiting for collaborator output in this session window.",
    "- Preserved issue continuity and completed the session with a fallback handoff summary.",
    "- Re-run implementation session when collaborator capacity is available for concrete file output.",
  ].join("\n");
}

export function buildLinearThenvoiBridgePrompt(): string {
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
- When you inspect peers, think in role terms first:
  - planning or ticket enrichment: look for a planner agent first, then a reviewer agent to tighten the result
  - implementation: look for a coder, implementer, engineer, or developer agent to do the file work, and use a reviewer agent when review is needed
  - treat peer name, handle, and description as role signals; matches like planner, reviewer, coder, implementer, developer, Claude Planner, and Codex Reviewer all count
- Use linear_get_issue and linear_list_issue_comments when you need authoritative ticket reads.
- Use linear_list_workflow_states before moving an issue into a review state so you use the correct state id for that team.
- If you call get_issue or list_comments, use the exact UUID issue_id from the bridge payload. Never use issue_identifier with those tools.
- Use the exact Linear tool names exposed in this room:
  - linear_post_thought for bridge reasoning updates
  - linear_post_action for visible work progress
  - linear_post_error for failures
  - linear_post_response for the final answer and session completion
  - linear_update_plan when you have a step list worth showing
- Start alone, but inspect available peers before deciding whether the bridge should handle the work itself.
- Only use thenvoi_lookup_peers when the room does not already contain a clearly relevant collaborator or when you need to replace/expand the current set of specialists. Choose collaborators based on the actual request and the visible peer identity you observe, not from a fixed handoff graph.
- When you invite a specialist, ask for one concrete deliverable and wait briefly for their reply before deciding the next step.
- Do not block indefinitely on silent specialists. If a collaborator does not make visible progress after a short attempt, say that explicitly and continue with the best bridge-only response or choose a different collaborator.
- Do not ask specialists to coordinate the workflow or to talk to Linear.
- If the request is planning-only, produce a sharper ticket: title, summary, scope, acceptance criteria, and implementation outline. Write those updates back to Linear and complete the session without pretending code was written.
- For planning sessions, prefer a two-step specialist path when available: ask a planner for the first implementation plan, then ask a reviewer to challenge and tighten it before writeback.
- If the request is implementation, ask a relevant implementation specialist to work in an isolated workspace and report concrete files, run steps, and blockers.
- Use linear_add_issue_comment for durable handoff notes when the plan or implementation summary should live on the ticket itself.
- Do not create chatter. Use linear_post_thought and linear_post_action only when state meaningfully changes.
- Do not restate completion after the session is already complete.
- Use linear_ask_user only when the room is blocked on human input.
- Use linear_post_response only after you have enough information to give the user the final answer.
- If the room message says the session was canceled, stop.
- Treat issue state and assignee information in the room context as a workflow hint:
  - if the ticket is being enriched or clarified and a planning-oriented specialist is available, you should delegate the first planning pass to that specialist instead of doing the planning work yourself
  - if a review-oriented specialist is also available during planning, use them to tighten the implementation plan before you post it back to Linear
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
