import { LinearDocument as L } from "@linear/sdk";

import { UnsupportedFeatureError } from "../../core/errors";
import { NoopLogger, type Logger } from "../../core/logger";
import type { RestApi } from "../../client/rest/types";
import type { PeerRecord } from "../../contracts/dtos";
import type {
  HandleAgentSessionEventInput,
  LinearThenvoiBridgeConfig,
  PendingBootstrapRequest,
  SessionRoomStore,
  SessionRoomRecord,
} from "./types";
import { dedupeHandles, stripHandlePrefix } from "./handles";
import { postThought, postError } from "./activities";

interface NormalizedBridgeConfig {
  roomStrategy: "issue" | "session";
  writebackMode: "final_only" | "activity_stream";
  hostAgentHandle: string | null;
}

type SessionIntent = "planning" | "implementation";

const SUPPORTED_ACTIONS = new Set(["created", "updated", "canceled", "prompted"]);
const MAX_PEER_LOOKUP_PAGES = 25;
const PEER_PAGE_SIZE = 100;
const RECOVERED_ROOM_EVENT_RETRY_LIMIT = 2;
const RECOVERED_ROOM_EVENT_RETRY_BASE_DELAY_MS = 1_000;

// Guards against concurrent room creation for the same session.
const roomResolutionLocks = new Map<string, Promise<SessionRoomRecord>>();
const resolvedHostHandleCache = new WeakMap<RestApi, string>();
const authenticatedHostHandleCache = new WeakMap<RestApi, string>();

export function getAgentSessionEventKey(
  payload: HandleAgentSessionEventInput["payload"],
): string {
  return [
    payload.agentSession.id,
    normalizeAction(payload.action) ?? String(payload.action ?? "unknown"),
    payload.agentSession.updatedAt ?? payload.agentSession.createdAt ?? "",
    typeof payload.webhookTimestamp === "number" ? String(payload.webhookTimestamp) : "",
  ].join(":");
}

export async function handleAgentSessionEvent(
  input: HandleAgentSessionEventInput,
  options?: {
    skipAcknowledgment?: boolean;
    expectedEventKey?: string;
    skipRoomWrite?: boolean;
  },
): Promise<void> {
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
  const eventKey = options?.expectedEventKey ?? getAgentSessionEventKey(input.payload);
  const existingBySession = await input.deps.store.getBySessionId(sessionId);
  if (existingBySession?.lastEventKey === eventKey) {
    logger.info("linear_thenvoi_bridge.duplicate_event_skipped", {
      sessionId,
      issueId,
      action,
      eventKey,
    });
    return;
  }

  if (action === "canceled") {
    await handleCanceledAction({
      deps: input.deps,
      logger,
      sessionId,
      issueId,
      eventKey,
      payloadAction: input.payload.action,
      skipRoomWrite: options?.skipRoomWrite ?? false,
    });
    return;
  }

  if (action === "prompted") {
    await handlePromptedAction({
      deps: input.deps,
      config,
      logger,
      sessionId,
      eventKey,
      payload: input.payload,
      skipRoomWrite: options?.skipRoomWrite ?? false,
    });
    return;
  }

  // Acknowledge receipt to Linear before room resolution (created only).
  if (action === "created" && !options?.skipAcknowledgment) {
    try {
      await postThought(input.deps.linearClient, sessionId, "Received session. Setting up workspace...");
    } catch (ackError) {
      logger.warn("linear_thenvoi_bridge.acknowledgment_failed", {
        sessionId,
        error: ackError instanceof Error ? ackError.message : String(ackError),
      });
    }
  }

  let roomRecord: SessionRoomRecord | null = null;
  try {
    const hostAgentHandle = await resolveHostAgentHandle({
      thenvoiRest: input.deps.thenvoiRest,
      configuredHostHandle: config.hostAgentHandle,
      logger,
    });
    const existingByIssue = config.roomStrategy === "issue" && issueId
      ? await input.deps.store.getByIssueId(issueId)
      : null;
    roomRecord = await resolveRoomRecord({
      thenvoiRest: input.deps.thenvoiRest,
      store: input.deps.store,
      roomStrategy: config.roomStrategy,
      sessionId,
      issueId,
      logger,
    });

    const sessionIntent = detectSessionIntent({
      issueStateType: extractIssueStateField(input.payload.agentSession.issue, "type"),
      promptContext: input.payload.promptContext,
      commentBody: input.payload.agentSession.comment?.body,
      issueTitle: input.payload.agentSession.issue?.title,
      issueDescription: input.payload.agentSession.issue?.description,
    });
    const suggestedPeerHandles = await selectRelevantPeerHandles({
      thenvoiRest: input.deps.thenvoiRest,
      roomId: roomRecord.thenvoiRoomId,
      intent: sessionIntent,
      hostAgentHandle,
      logger,
    });

    const allHandles = dedupeHandles([
      hostAgentHandle,
      ...suggestedPeerHandles,
    ]);

    await ensureRoomParticipants({
      thenvoiRest: input.deps.thenvoiRest,
      roomId: roomRecord.thenvoiRoomId,
      handles: allHandles,
      logger,
    });

    if (suggestedPeerHandles.length > 0) {
      await notifySuggestedPeers({
        thenvoiRest: input.deps.thenvoiRest,
        roomId: roomRecord.thenvoiRoomId,
        suggestedPeerHandles,
        sessionIntent,
        logger,
      });
    }

    const message = buildBridgeMessage({
      sessionId,
      issueId,
      issueIdentifier: input.payload.agentSession.issue?.identifier,
      sessionStatus: input.payload.agentSession.status,
      sessionType: input.payload.agentSession.type,
      sessionCreatedAt: input.payload.agentSession.createdAt,
      sessionUpdatedAt: input.payload.agentSession.updatedAt,
      action,
      hostHandle: hostAgentHandle,
      promptContext: input.payload.promptContext,
      issueTitle: input.payload.agentSession.issue?.title,
      issueDescription: input.payload.agentSession.issue?.description,
      issueUrl: input.payload.agentSession.issue?.url,
      issueTeamKey: extractIssueTeamKey(input.payload.agentSession.issue),
      issueTeamName: extractIssueTeamName(input.payload.agentSession.issue),
      issueTeamId: extractIssueTeamId(input.payload.agentSession.issue),
      issueStateId: extractIssueStateField(input.payload.agentSession.issue, "id"),
      issueStateName: extractIssueStateField(input.payload.agentSession.issue, "name"),
      issueStateType: extractIssueStateField(input.payload.agentSession.issue, "type"),
      issueAssigneeId: extractIssueAssigneeField(input.payload.agentSession.issue, "id"),
      issueAssigneeName:
        extractIssueAssigneeField(input.payload.agentSession.issue, "displayName")
        ?? extractIssueAssigneeField(input.payload.agentSession.issue, "name"),
      commentBody: input.payload.agentSession.comment?.body,
      commentId: input.payload.agentSession.comment?.id,
      sessionIntent,
      suggestedPeerHandles,
      webhookId: input.payload.webhookId,
      webhookTimestamp: input.payload.webhookTimestamp,
      oauthClientId: input.payload.oauthClientId,
      organizationId: input.payload.organizationId,
      appUserId: input.payload.appUserId,
      writebackMode: config.writebackMode,
    });

    const messageMetadata = {
      linear_event_action: action,
      linear_session_id: sessionId,
      linear_issue_id: issueId,
      linear_prompt_context: input.payload.promptContext ?? null,
      linear_writeback_mode: config.writebackMode,
      linear_bridge: "thenvoi",
      linear_host_handle: hostAgentHandle,
    };
    const shouldResetRoomSession = Boolean(
      existingByIssue
      && existingByIssue.linearSessionId !== sessionId
      && existingByIssue.thenvoiRoomId === roomRecord.thenvoiRoomId
      && (existingByIssue.status === "completed" || existingByIssue.status === "errored"),
    );

    const authenticatedHostHandle = authenticatedHostHandleCache.get(input.deps.thenvoiRest) ?? null;
    const canBootstrapDirectly = options?.skipRoomWrite === true
      || authenticatedHostHandle === null
      || authenticatedHostHandle === hostAgentHandle;
    if (!options?.skipRoomWrite || !canBootstrapDirectly) {
      roomRecord = await forwardBridgeMessage({
        thenvoiRest: input.deps.thenvoiRest,
        store: input.deps.store,
        logger,
        roomRecord,
        hostAgentHandle,
        sessionId,
        issueId,
        message,
        messageType: "task",
        metadata: messageMetadata,
      });
    }
    if (canBootstrapDirectly) {
      await enqueueBootstrapRequest(input.deps.store, {
        eventKey,
        linearSessionId: sessionId,
        thenvoiRoomId: roomRecord.thenvoiRoomId,
        expectedContent: message,
        messageType: "task",
        metadata: shouldResetRoomSession
          ? {
            ...messageMetadata,
            linear_reset_room_session: true,
          }
          : messageMetadata,
      });
    }

    await saveSessionRecord(input.deps.store, {
      ...roomRecord,
      status: "active",
      lastEventKey: eventKey,
      updatedAt: new Date().toISOString(),
    });

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

    if (roomRecord) {
      await saveSessionRecord(input.deps.store, {
        ...roomRecord,
        status: "errored",
        lastEventKey: eventKey,
        updatedAt: new Date().toISOString(),
      });
    } else if (existingBySession) {
      await saveSessionRecord(input.deps.store, {
        ...existingBySession,
        status: "errored",
        lastEventKey: eventKey,
        updatedAt: new Date().toISOString(),
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
  await completeLinearSession(input);
}

export async function completeLinearSession(input: {
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
  store?: SessionRoomStore;
  lastEventKey?: string | null;
}): Promise<void> {
  await input.linearClient.createAgentActivity({
    agentSessionId: input.agentSessionId,
    content: {
      type: L.AgentActivityType.Response,
      body: input.body,
    },
  });

  const existing = await input.store?.getBySessionId(input.agentSessionId);
  if (!existing || !input.store) {
    return;
  }

  await saveSessionRecord(input.store, {
    ...existing,
    status: "completed",
    lastEventKey: input.lastEventKey ?? existing.lastEventKey ?? null,
    updatedAt: new Date().toISOString(),
  });
}

function normalizeConfig(config: LinearThenvoiBridgeConfig): NormalizedBridgeConfig {
  return {
    roomStrategy: config.roomStrategy ?? "issue",
    writebackMode: config.writebackMode ?? "final_only",
    hostAgentHandle: normalizeOptionalHandle(config.hostAgentHandle),
  };
}

function normalizeOptionalHandle(handle: string | null | undefined): string | null {
  if (!handle) {
    return null;
  }

  const normalized = stripHandlePrefix(handle);
  return normalized.length > 0 ? normalized : null;
}

async function resolveHostAgentHandle(input: {
  thenvoiRest: RestApi;
  configuredHostHandle: string | null;
  logger: Logger;
}): Promise<string> {
  if (input.configuredHostHandle) {
    const cachedAuthenticated = authenticatedHostHandleCache.get(input.thenvoiRest);
    if (cachedAuthenticated && input.configuredHostHandle !== cachedAuthenticated) {
      input.logger.warn("linear_thenvoi_bridge.host_handle_differs_from_authenticated_agent", {
        configuredHostHandle: input.configuredHostHandle,
        authenticatedHandle: cachedAuthenticated,
      });
    }

    if (!cachedAuthenticated) {
      try {
        const identity = await input.thenvoiRest.getAgentMe();
        const authenticatedAgentHandle = normalizeOptionalHandle(identity.handle);
        if (authenticatedAgentHandle) {
          authenticatedHostHandleCache.set(input.thenvoiRest, authenticatedAgentHandle);
          if (input.configuredHostHandle !== authenticatedAgentHandle) {
            input.logger.warn("linear_thenvoi_bridge.host_handle_differs_from_authenticated_agent", {
              configuredHostHandle: input.configuredHostHandle,
              authenticatedHandle: authenticatedAgentHandle,
              agentId: identity.id,
            });
          }
        }
      } catch (error) {
        input.logger.warn("linear_thenvoi_bridge.host_handle_validation_skipped", {
          configuredHostHandle: input.configuredHostHandle,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return input.configuredHostHandle;
  }

  const cachedAuthenticated = authenticatedHostHandleCache.get(input.thenvoiRest);
  if (cachedAuthenticated) {
    resolvedHostHandleCache.set(input.thenvoiRest, cachedAuthenticated);
    return cachedAuthenticated;
  }

  const cached = resolvedHostHandleCache.get(input.thenvoiRest);
  if (cached) {
    return cached;
  }

  const identity = await input.thenvoiRest.getAgentMe();
  const authenticatedAgentHandle = normalizeOptionalHandle(identity.handle);
  if (authenticatedAgentHandle) {
    authenticatedHostHandleCache.set(input.thenvoiRest, authenticatedAgentHandle);
    resolvedHostHandleCache.set(input.thenvoiRest, authenticatedAgentHandle);
    return authenticatedAgentHandle;
  }

  throw new Error(
    "Linear bridge could not resolve the host agent handle. Set hostAgentHandle or use a REST adapter whose getAgentMe() returns handle.",
  );
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
  eventKey: string;
  payloadAction: string;
  skipRoomWrite: boolean;
}): Promise<void> {
  const existing = await input.deps.store.getBySessionId(input.sessionId);
  if (!existing) {
    input.logger.info("linear_thenvoi_bridge.session_canceled_without_room", {
      sessionId: input.sessionId,
      issueId: input.issueId,
      action: input.payloadAction,
    });
    return;
  }

  await saveSessionRecord(input.deps.store, {
    ...existing,
    status: "canceled",
    lastEventKey: input.eventKey,
    updatedAt: new Date().toISOString(),
  });

  if (existing && !input.skipRoomWrite) {
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
  config: NormalizedBridgeConfig;
  logger: Logger;
  sessionId: string;
  eventKey: string;
  payload: HandleAgentSessionEventInput["payload"];
  skipRoomWrite: boolean;
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

  const message = `[Linear User Response]: ${userResponse}`;
  const metadata = {
    linear_event_action: "prompted",
    linear_session_id: input.sessionId,
    linear_bridge: "thenvoi",
  };

  const authenticatedHostHandle = normalizeOptionalHandle(
    (await input.deps.thenvoiRest.getAgentMe()).handle,
  );
  const canBootstrapDirectly = authenticatedHostHandle === input.config.hostAgentHandle;
  if (!input.skipRoomWrite || !canBootstrapDirectly) {
    await input.deps.thenvoiRest.createChatEvent(existing.thenvoiRoomId, {
      content: message,
      messageType: "text",
      metadata,
    });
  }
  if (canBootstrapDirectly) {
    await enqueueBootstrapRequest(input.deps.store, {
      eventKey: input.eventKey,
      linearSessionId: input.sessionId,
      thenvoiRoomId: existing.thenvoiRoomId,
      expectedContent: message,
      messageType: "text",
      metadata,
    });
  }

  await saveSessionRecord(input.deps.store, {
    ...existing,
    status: "waiting",
    lastEventKey: input.eventKey,
    updatedAt: new Date().toISOString(),
  });

  input.logger.info("linear_thenvoi_bridge.prompted_forwarded", {
    sessionId: input.sessionId,
    roomId: existing.thenvoiRoomId,
  });
}

async function enqueueBootstrapRequest(
  store: SessionRoomStore,
  request: Pick<
    PendingBootstrapRequest,
    "eventKey" | "linearSessionId" | "thenvoiRoomId" | "expectedContent" | "messageType" | "metadata"
  >,
): Promise<void> {
  const now = new Date();
  await store.enqueueBootstrapRequest({
    ...request,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
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

async function forwardBridgeMessage(input: {
  thenvoiRest: RestApi;
  store: SessionRoomStore;
  logger: Logger;
  roomRecord: SessionRoomRecord;
  hostAgentHandle: string;
  sessionId: string;
  issueId: string | null;
  message: string;
  messageType: string;
  metadata: Record<string, unknown>;
}): Promise<SessionRoomRecord> {
  try {
    await input.thenvoiRest.createChatEvent(input.roomRecord.thenvoiRoomId, {
      content: input.message,
      messageType: input.messageType,
      metadata: input.metadata,
    });
    return input.roomRecord;
  } catch (error) {
    if (!isRecoverableRoomAccessError(error)) {
      throw error;
    }

    input.logger.warn("linear_thenvoi_bridge.room_forward_recovering_with_fresh_room", {
      sessionId: input.sessionId,
      issueId: input.issueId,
      previousRoomId: input.roomRecord.thenvoiRoomId,
      error: error instanceof Error ? error.message : String(error),
    });

    const recoveredRoom = await createFreshRoomRecord({
      thenvoiRest: input.thenvoiRest,
      store: input.store,
      sessionId: input.sessionId,
      issueId: input.issueId,
      logger: input.logger,
    });

    await ensureRoomParticipants({
      thenvoiRest: input.thenvoiRest,
      roomId: recoveredRoom.thenvoiRoomId,
      handles: [input.hostAgentHandle],
      logger: input.logger,
    });

    let attempt = 0;
    while (true) {
      try {
        await input.thenvoiRest.createChatEvent(recoveredRoom.thenvoiRoomId, {
          content: input.message,
          messageType: input.messageType,
          metadata: input.metadata,
        });
        return recoveredRoom;
      } catch (recoveredError) {
        if (!isRetryableRecoveredRoomEventError(recoveredError) || attempt >= RECOVERED_ROOM_EVENT_RETRY_LIMIT) {
          throw recoveredError;
        }

        attempt += 1;
        input.logger.warn("linear_thenvoi_bridge.room_recreated_retrying", {
          sessionId: input.sessionId,
          issueId: input.issueId,
          roomId: recoveredRoom.thenvoiRoomId,
          attempt,
          delayMs: RECOVERED_ROOM_EVENT_RETRY_BASE_DELAY_MS * attempt,
          error: recoveredError instanceof Error ? recoveredError.message : String(recoveredError),
        });
        await sleep(RECOVERED_ROOM_EVENT_RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }
}

function isRecoverableRoomAccessError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /\/api\/v1\/agent\/chats\/.+\/events failed \((403|404)/.test(error.message);
}

function isRetryableRecoveredRoomEventError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /\/api\/v1\/agent\/chats\/.+\/events failed \((403|404|429)/.test(error.message);
}

function isRetryableRateLimitError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "retryable" in error) {
    return (error as { retryable?: boolean }).retryable === true;
  }

  return error instanceof Error && /\b429\b/.test(error.message);
}

async function createFreshRoomRecord(input: {
  thenvoiRest: RestApi;
  store: SessionRoomStore;
  sessionId: string;
  issueId: string | null;
  logger: Logger;
}): Promise<SessionRoomRecord> {
  const now = new Date().toISOString();
  const created = await input.thenvoiRest.createChat();
  const record: SessionRoomRecord = {
    linearSessionId: input.sessionId,
    linearIssueId: input.issueId,
    thenvoiRoomId: created.id,
    status: "active",
    lastEventKey: null,
    createdAt: now,
    updatedAt: now,
  };

  await input.store.upsert(record);
  input.logger.info("linear_thenvoi_bridge.room_recreated", {
    sessionId: input.sessionId,
    issueId: input.issueId,
    roomId: created.id,
  });
  return record;
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
  if (existingBySession && existingBySession.status !== "canceled") {
    return existingBySession;
  }

  if (input.roomStrategy === "issue" && input.issueId) {
    const existingByIssue = await input.store.getByIssueId(input.issueId);
    if (existingByIssue && existingByIssue.status !== "canceled") {
      const now = new Date().toISOString();
      const linkedRecord: SessionRoomRecord = {
        linearSessionId: input.sessionId,
        linearIssueId: input.issueId,
        thenvoiRoomId: existingByIssue.thenvoiRoomId,
        status: "active",
        lastEventKey: existingBySession?.lastEventKey ?? null,
        createdAt: existingBySession?.createdAt ?? now,
        updatedAt: now,
      };

      await input.store.upsert(linkedRecord);
      return linkedRecord;
    }
  }

  const now = new Date().toISOString();
  // Thenvoi validates `chat.task_id` as a Thenvoi task UUID. Linear issue/session IDs
  // are external identifiers, so this bridge must omit `task_id` unless it has a real
  // Thenvoi task to associate with the room.
  const created = await input.thenvoiRest.createChat();
  const createdRecord: SessionRoomRecord = {
    linearSessionId: input.sessionId,
    linearIssueId: input.issueId,
    thenvoiRoomId: created.id,
    status: "active",
    lastEventKey: null,
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

  let existingParticipants;
  try {
    existingParticipants = await input.thenvoiRest.listChatParticipants(input.roomId);
  } catch (error) {
    if (isRetryableRateLimitError(error)) {
      input.logger.warn("linear_thenvoi_bridge.participant_list_rate_limited", {
        roomId: input.roomId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    throw error;
  }
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
      if (!isRetryableRateLimitError(error)) {
        throw error;
      }
    }
  }
}

async function notifySuggestedPeers(input: {
  thenvoiRest: RestApi;
  roomId: string;
  suggestedPeerHandles: string[];
  sessionIntent: SessionIntent;
  logger: Logger;
}): Promise<void> {
  if (input.suggestedPeerHandles.length === 0) {
    return;
  }

  let participants;
  try {
    participants = await input.thenvoiRest.listChatParticipants(input.roomId);
  } catch (error) {
    if (isRetryableRateLimitError(error)) {
      input.logger.warn("linear_thenvoi_bridge.peer_bootstrap_skipped_rate_limited", {
        roomId: input.roomId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    throw error;
  }
  const participantMentions: Array<{ id: string; handle?: string; name?: string }> = [];
  for (const participant of participants) {
    const normalizedHandle = normalizeOptionalHandle(participant.handle ?? participant.name);
    if (!normalizedHandle || !input.suggestedPeerHandles.includes(normalizedHandle)) {
      continue;
    }

    participantMentions.push({
      id: participant.id,
      handle: participant.handle ?? undefined,
      name: participant.name || undefined,
    });
  }

  if (participantMentions.length === 0) {
    return;
  }

  const taskLine = input.sessionIntent === "implementation"
    ? "Specialists: if you are a good fit, implement the requested deliverable in your isolated workspace and report concrete files, run steps, and blockers back in this room."
    : "Specialists: if you are a good fit, sharpen the ticket into execution-ready scope, acceptance criteria, and implementation notes, then report the result back in this room.";
  const specialistHandlesLine = input.suggestedPeerHandles.map((handle) => `@${handle}`).join(" ");

  await input.thenvoiRest.createChatMessage(input.roomId, {
    content: [
      "Bridge agent: coordinate this session and own the Linear writeback.",
      specialistHandlesLine,
      taskLine,
      "Do not use Linear tools directly; the bridge owns Linear writeback.",
    ].join(" "),
    mentions: participantMentions,
  });

  input.logger.info("linear_thenvoi_bridge.peer_bootstrap_sent", {
    roomId: input.roomId,
    sessionIntent: input.sessionIntent,
    handles: input.suggestedPeerHandles,
  });
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
  sessionId: string;
  issueId: string | null;
  issueIdentifier: string | null | undefined;
  sessionStatus: string | null | undefined;
  sessionType: string | null | undefined;
  sessionCreatedAt: string | null | undefined;
  sessionUpdatedAt: string | null | undefined;
  action: "created" | "updated";
  hostHandle: string;
  promptContext: string | null | undefined;
  issueTitle: string | null | undefined;
  issueDescription: string | null | undefined;
  issueUrl: string | null | undefined;
  issueTeamKey: string | null | undefined;
  issueTeamName: string | null | undefined;
  issueTeamId: string | null | undefined;
  issueStateId: string | null | undefined;
  issueStateName: string | null | undefined;
  issueStateType: string | null | undefined;
  issueAssigneeId: string | null | undefined;
  issueAssigneeName: string | null | undefined;
  commentBody: string | null | undefined;
  commentId: string | null | undefined;
  sessionIntent: SessionIntent;
  suggestedPeerHandles: string[];
  webhookId: string | null | undefined;
  webhookTimestamp: number | null | undefined;
  oauthClientId: string | null | undefined;
  organizationId: string | null | undefined;
  appUserId: string | null | undefined;
  writebackMode: "final_only" | "activity_stream";
}): string {
  const lead = `@${input.hostHandle}`;
  const header = input.action === "created"
    ? "[Linear]: Agent session created."
    : "[Linear]: Agent session updated.";

  const issueIdLine = input.issueId ? `issue_id: ${input.issueId}` : "issue_id: none";
  const issueIdentifierLine = input.issueIdentifier
    ? `issue_identifier: ${input.issueIdentifier}`
    : "issue_identifier: none";
  const issueTitleLine = input.issueTitle ? `issue_title: ${input.issueTitle}` : "issue_title: none";
  const issueUrlLine = input.issueUrl ? `issue_url: ${input.issueUrl}` : "issue_url: none";
  const issueTeamLine = firstNonEmpty(input.issueTeamKey, input.issueTeamName)
    ? `issue_team: ${firstNonEmpty(input.issueTeamKey, input.issueTeamName)}`
    : "issue_team: none";
  const issueTeamIdLine = input.issueTeamId ? `issue_team_id: ${input.issueTeamId}` : "issue_team_id: none";
  const issueStateLine = firstNonEmpty(input.issueStateName, input.issueStateType)
    ? `issue_state: ${firstNonEmpty(input.issueStateName, input.issueStateType)}`
    : "issue_state: none";
  const issueStateIdLine = input.issueStateId ? `issue_state_id: ${input.issueStateId}` : "issue_state_id: none";
  const issueStateTypeLine = input.issueStateType ? `issue_state_type: ${input.issueStateType}` : "issue_state_type: none";
  const issueAssigneeLine = input.issueAssigneeName
    ? `issue_assignee: ${input.issueAssigneeName}`
    : "issue_assignee: none";
  const issueAssigneeIdLine = input.issueAssigneeId
    ? `issue_assignee_id: ${input.issueAssigneeId}`
    : "issue_assignee_id: none";
  const sessionStatusLine = input.sessionStatus ? `session_status: ${input.sessionStatus}` : "session_status: none";
  const sessionTypeLine = input.sessionType ? `session_type: ${input.sessionType}` : "session_type: none";
  const sessionCreatedLine = input.sessionCreatedAt
    ? `session_created_at: ${input.sessionCreatedAt}`
    : "session_created_at: none";
  const sessionUpdatedLine = input.sessionUpdatedAt
    ? `session_updated_at: ${input.sessionUpdatedAt}`
    : "session_updated_at: none";
  const appUserLine = input.appUserId ? `app_user_id: ${input.appUserId}` : "app_user_id: none";
  const organizationLine = input.organizationId
    ? `organization_id: ${input.organizationId}`
    : "organization_id: none";
  const oauthClientLine = input.oauthClientId
    ? `oauth_client_id: ${input.oauthClientId}`
    : "oauth_client_id: none";
  const webhookIdLine = input.webhookId ? `webhook_id: ${input.webhookId}` : "webhook_id: none";
  const webhookTimestampLine = typeof input.webhookTimestamp === "number"
    ? `webhook_timestamp: ${input.webhookTimestamp}`
    : "webhook_timestamp: none";
  const commentIdLine = input.commentId ? `comment_id: ${input.commentId}` : "comment_id: none";

  const promptContext = firstNonEmpty(input.promptContext) ?? "none";
  const issueDescription = firstNonEmpty(input.issueDescription) ?? "none";
  const commentBody = firstNonEmpty(input.commentBody) ?? "none";
  const suggestedPeersLine = input.suggestedPeerHandles.length > 0
    ? input.suggestedPeerHandles.map((handle) => `  - @${handle}`).join("\n")
    : "  - none";
  const transportPrefetchedLine = input.suggestedPeerHandles.length > 0
    ? "transport_prefetched_specialists: yes"
    : "transport_prefetched_specialists: no";
  return `${header} ${lead} please coordinate the response.

Linear session context:
- session_id: ${input.sessionId}
- ${sessionStatusLine}
- ${sessionTypeLine}
- ${sessionCreatedLine}
- ${sessionUpdatedLine}
- ${issueIdLine}
- ${issueIdentifierLine}
- ${issueTitleLine}
- ${issueUrlLine}
- ${issueTeamLine}
- ${issueTeamIdLine}
- ${issueStateLine}
- ${issueStateIdLine}
- ${issueStateTypeLine}
- ${issueAssigneeLine}
- ${issueAssigneeIdLine}
- inferred_session_intent: ${input.sessionIntent}
- ${transportPrefetchedLine}
- writeback_mode: ${input.writebackMode}
- ${appUserLine}
- ${organizationLine}
- ${oauthClientLine}
- ${webhookIdLine}
- ${webhookTimestampLine}

Bridge responsibilities:
- decide whether you can answer alone or need help
- invite specialists only when needed
- keep Linear updated with meaningful milestones
- call complete_session when the work is actually finished

Relevant peers already added to the room from the current registry snapshot:
${suggestedPeersLine}

Prompt context:
${promptContext}

Issue description:
${issueDescription}

Linked comment:
- ${commentIdLine}
${commentBody}`;
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

function detectSessionIntent(input: {
  issueStateType: string | null;
  promptContext: string | null | undefined;
  commentBody: string | null | undefined;
  issueTitle: string | null | undefined;
  issueDescription: string | null | undefined;
}): SessionIntent {
  if (input.issueStateType?.trim().toLowerCase() === "started") {
    return "implementation";
  }

  const explicitDirective = [
    input.promptContext,
    input.commentBody,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();

  if (/(please implement|implement (?:this|it|now|the)|build (?:this|it|now|the)|code (?:this|it|now|the)|ship (?:it|this)|start coding|start implementation|tighten|adjust|refine)/.test(explicitDirective)) {
    return "implementation";
  }

  return "planning";
}

async function selectRelevantPeerHandles(input: {
  thenvoiRest: RestApi;
  roomId: string;
  intent: SessionIntent;
  hostAgentHandle: string;
  logger: Logger;
}): Promise<string[]> {
  if (!input.thenvoiRest.listPeers) {
    return [];
  }

  let peers: PeerRecord[];
  try {
    const response = await input.thenvoiRest.listPeers({
      page: 1,
      pageSize: PEER_PAGE_SIZE,
      notInChat: input.roomId,
    });
    peers = response.data;
  } catch (error) {
    if (error instanceof UnsupportedFeatureError) {
      return [];
    }

    input.logger.warn("linear_thenvoi_bridge.peer_prefetch_failed", {
      roomId: input.roomId,
      intent: input.intent,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  const ranked = peers
    .map((peer) => {
      const handle = normalizeOptionalHandle(typeof peer.handle === "string" ? peer.handle : null);
      return {
        handle,
        score: scorePeerForIntent(peer, input.intent),
      };
    })
    .filter((candidate): candidate is { handle: string; score: number } =>
      typeof candidate.handle === "string"
      && candidate.handle.length > 0
      && candidate.handle !== input.hostAgentHandle,
    )
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  const selected = ranked.slice(0, 2).map((candidate) => candidate.handle);
  if (selected.length > 0) {
    input.logger.info("linear_thenvoi_bridge.peer_prefetch_selected", {
      roomId: input.roomId,
      intent: input.intent,
      handles: selected,
    });
  }

  return selected;
}

function scorePeerForIntent(peer: PeerRecord, intent: SessionIntent): number {
  const description = typeof peer.description === "string" ? peer.description : "";
  const haystack = [
    typeof peer.name === "string" ? peer.name : "",
    typeof peer.handle === "string" ? peer.handle : "",
    description,
  ].join(" ").toLowerCase();

  const weightedTerms = intent === "implementation"
    ? [
      { pattern: /\bimplementer\b|\bimplementation\b/, score: 10 },
      { pattern: /\bengineer\b|\bdeveloper\b|\bcoder\b|\bcoding\b/, score: 8 },
      { pattern: /\bbuild\b|\bfrontend\b|\bui\b/, score: 5 },
      { pattern: /\breviewer\b|\breview\b|\bplanner\b|\bplan\b/, score: -4 },
    ]
    : [
      { pattern: /\bplanner\b|\bplanning\b|\bplan\b/, score: 10 },
      { pattern: /\borchestrator\b|\barchitect\b|\bdesign\b|\bscope\b|\bspec\b/, score: 6 },
      { pattern: /\bimplementer\b|\bimplementation\b|\breviewer\b|\breview\b/, score: -3 },
    ];

  return weightedTerms.reduce((total, term) => (term.pattern.test(haystack) ? total + term.score : total), 0);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function extractIssueTeamKey(issue: unknown): string | null {
  const team = extractNestedRecord(issue, "team");
  return typeof team?.key === "string" ? team.key : null;
}

function extractIssueTeamName(issue: unknown): string | null {
  const team = extractNestedRecord(issue, "team");
  return typeof team?.name === "string" ? team.name : null;
}

function extractIssueTeamId(issue: unknown): string | null {
  const issueRecord = extractRecord(issue);
  if (typeof issueRecord?.teamId === "string") {
    return issueRecord.teamId;
  }

  const team = extractNestedRecord(issue, "team");
  return typeof team?.id === "string" ? team.id : null;
}

function extractIssueStateField(issue: unknown, field: "id" | "name" | "type"): string | null {
  const state = extractNestedRecord(issue, "state");
  const value = state?.[field];
  return typeof value === "string" ? value : null;
}

function extractIssueAssigneeField(issue: unknown, field: "id" | "name" | "displayName"): string | null {
  const assignee = extractNestedRecord(issue, "assignee");
  const value = assignee?.[field];
  return typeof value === "string" ? value : null;
}

function extractNestedRecord(value: unknown, key: string): Record<string, unknown> | null {
  const record = extractRecord(value);
  const nested = record?.[key];
  return extractRecord(nested);
}

function extractRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

async function saveSessionRecord(
  store: SessionRoomStore,
  record: SessionRoomRecord,
): Promise<void> {
  await store.upsert(record);
}
