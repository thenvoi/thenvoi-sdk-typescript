import { LinearDocument as L } from "@linear/sdk";

import { UnsupportedFeatureError } from "../../core/errors";
import { NoopLogger, type Logger } from "../../core/logger";
import type { ChatMessageMention, RestApi } from "../../client/rest/types";
import type {
  HandleAgentSessionEventInput,
  LinearThenvoiBridgeConfig,
  SessionRoomRecord,
} from "./types";
import { dedupeHandles, stripHandlePrefix } from "./handles";
import { postThought, postError } from "./activities";

interface NormalizedBridgeConfig {
  roomStrategy: "issue" | "session";
  writebackMode: "final_only";
  hostAgentHandle: string;
  defaultSpecialistHandles: string[];
}

const SUPPORTED_ACTIONS = new Set(["created", "updated", "canceled", "prompted"]);
const MAX_PEER_LOOKUP_PAGES = 25;
const PEER_PAGE_SIZE = 100;

// Guards against concurrent room creation for the same session.
const roomResolutionLocks = new Map<string, Promise<SessionRoomRecord>>();

export async function handleAgentSessionEvent(input: HandleAgentSessionEventInput): Promise<void> {
  const logger = input.deps.logger ?? new NoopLogger();
  const config = normalizeConfig(input.config);
  const action = normalizeAction(input.payload.action);

  if (!action) {
    logger.warn("linear_thenvoi_bridge.ignored_unknown_action", {
      action: input.payload.action,
      sessionId: input.payload.agentSession.id,
    });
    return;
  }

  const sessionId = input.payload.agentSession.id;
  const issueId = input.payload.agentSession.issueId ?? input.payload.agentSession.issue?.id ?? null;

  if (action === "canceled") {
    await handleCanceledAction({
      deps: input.deps,
      logger,
      sessionId,
      issueId,
      payloadAction: input.payload.action,
    });
    return;
  }

  if (action === "prompted") {
    await handlePromptedAction({
      deps: input.deps,
      logger,
      sessionId,
      payload: input.payload,
    });
    return;
  }

  // Acknowledge receipt to Linear before room resolution (created only).
  if (action === "created") {
    try {
      await postThought(input.deps.linearClient, sessionId, "Received session. Setting up workspace...");
    } catch (ackError) {
      logger.warn("linear_thenvoi_bridge.acknowledgment_failed", {
        sessionId,
        error: ackError instanceof Error ? ackError.message : String(ackError),
      });
    }
  }

  try {
    const roomRecord = await resolveRoomRecord({
      thenvoiRest: input.deps.thenvoiRest,
      store: input.deps.store,
      roomStrategy: config.roomStrategy,
      sessionId,
      issueId,
      logger,
    });

    const inferredHandles = extractMentionHandles([
      input.payload.promptContext,
      input.payload.agentSession.comment?.body,
      input.payload.agentSession.issue?.title,
      input.payload.agentSession.issue?.description,
    ]);

    const specialistHandles = dedupeHandles([
      ...config.defaultSpecialistHandles,
      ...inferredHandles,
    ]).filter((handle) => handle !== config.hostAgentHandle);

    const allHandles = dedupeHandles([
      config.hostAgentHandle,
      ...specialistHandles,
    ]);

    await ensureRoomParticipants({
      thenvoiRest: input.deps.thenvoiRest,
      roomId: roomRecord.thenvoiRoomId,
      handles: allHandles,
      logger,
    });

    const message = buildBridgeMessage({
      action,
      hostHandle: config.hostAgentHandle,
      specialistHandles,
      promptContext: input.payload.promptContext,
      issueTitle: input.payload.agentSession.issue?.title,
      commentBody: input.payload.agentSession.comment?.body,
    });

    const mentions = await resolveMentionTargets({
      thenvoiRest: input.deps.thenvoiRest,
      roomId: roomRecord.thenvoiRoomId,
      handles: [config.hostAgentHandle],
      logger,
    });

    await input.deps.thenvoiRest.createChatMessage(
      roomRecord.thenvoiRoomId,
      {
        content: message,
        messageType: "task",
        metadata: {
          linear_event_action: action,
          linear_session_id: sessionId,
          linear_issue_id: issueId,
          linear_prompt_context: input.payload.promptContext ?? null,
          linear_writeback_mode: config.writebackMode,
          linear_bridge: "thenvoi",
        },
        mentions,
      },
    );

    logger.info("linear_thenvoi_bridge.message_forwarded", {
      sessionId,
      issueId,
      roomId: roomRecord.thenvoiRoomId,
      action,
    });
  } catch (error) {
    // Report errors back to Linear before re-throwing.
    try {
      await postError(
        input.deps.linearClient,
        sessionId,
        `Bridge error: ${error instanceof Error ? error.message : String(error)}`,
      );
    } catch (reportError) {
      logger.warn("linear_thenvoi_bridge.error_reporting_failed", {
        sessionId,
        error: reportError instanceof Error ? reportError.message : String(reportError),
      });
    }

    throw error;
  }
}

export async function postFinalResponseToLinearSession(input: {
  linearClient: {
    createAgentActivity: (request: {
      agentSessionId: string;
      content: {
        type: L.AgentActivityType;
        body: string;
      };
    }) => Promise<unknown>;
  };
  agentSessionId: string;
  body: string;
}): Promise<void> {
  await input.linearClient.createAgentActivity({
    agentSessionId: input.agentSessionId,
    content: {
      type: L.AgentActivityType.Response,
      body: input.body,
    },
  });
}

function normalizeConfig(config: LinearThenvoiBridgeConfig): NormalizedBridgeConfig {
  return {
    roomStrategy: config.roomStrategy ?? "issue",
    writebackMode: config.writebackMode ?? "final_only",
    hostAgentHandle: stripHandlePrefix(config.hostAgentHandle),
    defaultSpecialistHandles: dedupeHandles(config.defaultSpecialistHandles ?? []),
  };
}

type SupportedAction = "created" | "updated" | "canceled" | "prompted";

function normalizeAction(action: string | null | undefined): SupportedAction | null {
  if (!action) {
    return null;
  }

  const normalized = action.trim().toLowerCase();
  if (!SUPPORTED_ACTIONS.has(normalized)) {
    return null;
  }

  return normalized as SupportedAction;
}

async function handleCanceledAction(input: {
  deps: HandleAgentSessionEventInput["deps"];
  logger: Logger;
  sessionId: string;
  issueId: string | null;
  payloadAction: string;
}): Promise<void> {
  await input.deps.store.markCanceled(input.sessionId);
  const existing = await input.deps.store.getBySessionId(input.sessionId);

  if (existing) {
    await input.deps.thenvoiRest.createChatEvent(existing.thenvoiRoomId, {
      content: "[Linear]: Agent session canceled. Stop in-room execution and await new instructions.",
      messageType: "task",
      metadata: {
        linear_event_action: "canceled",
        linear_session_id: input.sessionId,
        linear_issue_id: input.issueId,
        linear_bridge: "thenvoi",
      },
    });
  }

  input.logger.info("linear_thenvoi_bridge.session_canceled", {
    sessionId: input.sessionId,
    issueId: input.issueId,
    hadRoom: Boolean(existing),
    action: input.payloadAction,
  });
}

async function handlePromptedAction(input: {
  deps: HandleAgentSessionEventInput["deps"];
  logger: Logger;
  sessionId: string;
  payload: HandleAgentSessionEventInput["payload"];
}): Promise<void> {
  const existing = await input.deps.store.getBySessionId(input.sessionId);

  if (!existing) {
    input.logger.warn("linear_thenvoi_bridge.prompted_no_room", {
      sessionId: input.sessionId,
    });
    return;
  }

  const userResponse = extractPromptedResponseBody(input.payload);

  if (!userResponse) {
    input.logger.warn("linear_thenvoi_bridge.prompted_empty_response", {
      sessionId: input.sessionId,
    });
    return;
  }

  await input.deps.thenvoiRest.createChatMessage(
    existing.thenvoiRoomId,
    {
      content: `[Linear User Response]: ${userResponse}`,
      messageType: "text",
      metadata: {
        linear_event_action: "prompted",
        linear_session_id: input.sessionId,
        linear_bridge: "thenvoi",
      },
    },
  );

  input.logger.info("linear_thenvoi_bridge.prompted_forwarded", {
    sessionId: input.sessionId,
    roomId: existing.thenvoiRoomId,
  });
}

async function resolveRoomRecord(input: {
  thenvoiRest: RestApi;
  store: HandleAgentSessionEventInput["deps"]["store"];
  roomStrategy: "issue" | "session";
  sessionId: string;
  issueId: string | null;
  logger: Logger;
}): Promise<SessionRoomRecord> {
  // Prevent concurrent room creation for the same session.
  const lockKey = `${input.roomStrategy}:${input.sessionId}:${input.issueId ?? ""}`;
  const existing = roomResolutionLocks.get(lockKey);
  if (existing) {
    return existing;
  }

  const promise = resolveRoomRecordImpl(input);
  roomResolutionLocks.set(lockKey, promise);
  try {
    return await promise;
  } finally {
    roomResolutionLocks.delete(lockKey);
  }
}

async function resolveRoomRecordImpl(input: {
  thenvoiRest: RestApi;
  store: HandleAgentSessionEventInput["deps"]["store"];
  roomStrategy: "issue" | "session";
  sessionId: string;
  issueId: string | null;
  logger: Logger;
}): Promise<SessionRoomRecord> {
  const existingBySession = await input.store.getBySessionId(input.sessionId);
  if (existingBySession?.status === "active") {
    return existingBySession;
  }

  if (input.roomStrategy === "issue" && input.issueId) {
    const existingByIssue = await input.store.getByIssueId(input.issueId);
    if (existingByIssue?.status === "active") {
      const now = new Date().toISOString();
      const linkedRecord: SessionRoomRecord = {
        linearSessionId: input.sessionId,
        linearIssueId: input.issueId,
        thenvoiRoomId: existingByIssue.thenvoiRoomId,
        status: "active",
        createdAt: existingBySession?.createdAt ?? now,
        updatedAt: now,
      };

      await input.store.upsert(linkedRecord);
      return linkedRecord;
    }
  }

  const now = new Date().toISOString();
  const taskId = input.issueId
    ? `linear:issue:${input.issueId}`
    : `linear:session:${input.sessionId}`;
  const created = await input.thenvoiRest.createChat(taskId);
  const createdRecord: SessionRoomRecord = {
    linearSessionId: input.sessionId,
    linearIssueId: input.issueId,
    thenvoiRoomId: created.id,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  await input.store.upsert(createdRecord);

  input.logger.info("linear_thenvoi_bridge.room_created", {
    sessionId: input.sessionId,
    issueId: input.issueId,
    roomId: created.id,
    roomStrategy: input.roomStrategy,
  });

  return createdRecord;
}

async function ensureRoomParticipants(input: {
  thenvoiRest: RestApi;
  roomId: string;
  handles: string[];
  logger: Logger;
}): Promise<void> {
  if (input.handles.length === 0) {
    return;
  }

  const existingParticipants = await input.thenvoiRest.listChatParticipants(input.roomId);
  const existingHandles = new Set(
    existingParticipants
      .map((participant) => stripHandlePrefix(participant.handle ?? participant.name))
      .filter((value): value is string => value.length > 0),
  );

  const missingHandles = input.handles.filter((handle) => !existingHandles.has(handle));
  if (missingHandles.length === 0) {
    return;
  }

  let peersByHandle: Map<string, string>;
  try {
    peersByHandle = await lookupPeerIdsByHandle(input.thenvoiRest, input.roomId, missingHandles);
  } catch (error) {
    if (error instanceof UnsupportedFeatureError) {
      input.logger.warn("linear_thenvoi_bridge.peer_lookup_unavailable", {
        roomId: input.roomId,
        missingHandles,
        reason: error.message,
      });
      return;
    }

    throw error;
  }

  for (const handle of missingHandles) {
    const participantId = peersByHandle.get(handle);
    if (!participantId) {
      input.logger.warn("linear_thenvoi_bridge.peer_not_found", {
        roomId: input.roomId,
        handle,
      });
      continue;
    }

    try {
      await input.thenvoiRest.addChatParticipant(
        input.roomId,
        {
          participantId,
          role: "member",
        },
      );
    } catch (error) {
      input.logger.warn("linear_thenvoi_bridge.add_participant_failed", {
        roomId: input.roomId,
        handle,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function resolveMentionTargets(input: {
  thenvoiRest: RestApi;
  roomId: string;
  handles: string[];
  logger: Logger;
}): Promise<ChatMessageMention[]> {
  const targets = new Map<string, ChatMessageMention>();
  if (input.handles.length === 0) {
    return [];
  }

  const participants = await input.thenvoiRest.listChatParticipants(input.roomId);
  for (const participant of participants) {
    const normalized = stripHandlePrefix(participant.handle ?? participant.name);
    if (!input.handles.includes(normalized)) {
      continue;
    }

    targets.set(normalized, {
      id: participant.id,
      handle: participant.handle ?? undefined,
      username: participant.name,
    });
  }

  return [...targets.values()];
}

async function lookupPeerIdsByHandle(
  thenvoiRest: RestApi,
  roomId: string,
  handles: string[],
): Promise<Map<string, string>> {
  if (!thenvoiRest.listPeers) {
    throw new UnsupportedFeatureError("Peer listing is not available in current REST adapter");
  }

  const targets = new Set(handles);
  const found = new Map<string, string>();

  for (let page = 1; page <= MAX_PEER_LOOKUP_PAGES && found.size < targets.size; page += 1) {
    const response = await thenvoiRest.listPeers({
      page,
      pageSize: PEER_PAGE_SIZE,
      notInChat: roomId,
    });

    for (const peer of response.data) {
      const peerId = peer.id;
      if (typeof peerId !== "string" || peerId.length === 0) {
        continue;
      }

      const handleCandidates = [
        typeof peer.handle === "string" ? stripHandlePrefix(peer.handle) : "",
        typeof peer.name === "string" ? stripHandlePrefix(peer.name) : "",
      ].filter((value): value is string => value.length > 0);

      for (const candidate of handleCandidates) {
        if (!targets.has(candidate)) {
          continue;
        }

        found.set(candidate, peerId);
      }
    }

    if (response.data.length < PEER_PAGE_SIZE) {
      break;
    }
  }

  return found;
}

function buildBridgeMessage(input: {
  action: "created" | "updated";
  hostHandle: string;
  specialistHandles: string[];
  promptContext: string | null | undefined;
  issueTitle: string | null | undefined;
  commentBody: string | null | undefined;
}): string {
  const lead = `@${input.hostHandle}`;
  const specialists = input.specialistHandles.length > 0
    ? ` Specialists: ${input.specialistHandles.map((handle) => `@${handle}`).join(", ")}.`
    : "";

  const context =
    firstNonEmpty(input.promptContext, input.commentBody, input.issueTitle) ??
    "No explicit prompt context was provided by Linear.";

  const header = input.action === "created"
    ? "[Linear]: Agent session created."
    : "[Linear]: Agent session updated.";

  return `${header} ${lead} please coordinate the response.${specialists}\n\nContext:\n${context}`;
}

function extractMentionHandles(chunks: Array<string | null | undefined>): string[] {
  const handles: string[] = [];
  const matcher = /@([a-zA-Z0-9_.-]+)/g;

  for (const chunk of chunks) {
    if (!chunk) {
      continue;
    }

    for (const match of chunk.matchAll(matcher)) {
      const handle = match[1];
      if (!handle) {
        continue;
      }

      handles.push(handle);
    }
  }

  return dedupeHandles(handles);
}

/** Extract `agentActivity.content.body` from a prompted webhook payload. */
function extractPromptedResponseBody(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const activity = record.agentActivity;
  if (typeof activity !== "object" || activity === null) {
    return "";
  }

  const content = (activity as Record<string, unknown>).content;
  if (typeof content !== "object" || content === null) {
    return "";
  }

  const body = (content as Record<string, unknown>).body;
  return typeof body === "string" ? body : "";
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (!value) {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return null;
}
