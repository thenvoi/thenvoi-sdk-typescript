import type { AppUserNotificationWebhookPayloadWithNotification } from "@linear/sdk/webhooks";

import type { Logger } from "../../core/logger";
import type { LinearThenvoiBridgeDeps } from "./types";

export interface HandleAppUserNotificationInput {
  payload: AppUserNotificationWebhookPayloadWithNotification;
  deps: LinearThenvoiBridgeDeps;
  logger: Logger;
}

export async function handleAppUserNotification(
  input: HandleAppUserNotificationInput,
): Promise<void> {
  const { payload, deps, logger } = input;
  const notification = payload.notification;
  const typename = notification.__typename;

  switch (typename) {
    case "IssueUnassignedFromYouNotificationWebhookPayload":
      await handleIssueUnassigned({ notification, deps, logger });
      return;
    case "IssueNewCommentNotificationWebhookPayload":
      await handleIssueNewComment({ notification, deps, logger });
      return;
    case "IssueCommentReactionNotificationWebhookPayload":
    case "IssueEmojiReactionNotificationWebhookPayload":
      logReaction({ notification, logger });
      return;
    default:
      logger.info("linear_thenvoi_bridge.notification_unhandled", {
        notificationType: typename,
      });
  }
}

async function handleIssueUnassigned(input: {
  notification: { issueId: string; actorId?: string | null };
  deps: LinearThenvoiBridgeDeps;
  logger: Logger;
}): Promise<void> {
  const { notification, deps, logger } = input;
  const existing = await deps.store.getByIssueId(notification.issueId);

  if (!existing) {
    logger.info("linear_thenvoi_bridge.notification_unassigned_no_session", {
      issueId: notification.issueId,
    });
    return;
  }

  await deps.store.upsert({
    ...existing,
    status: "canceled",
    updatedAt: new Date().toISOString(),
  });

  await deps.thenvoiRest.createChatEvent(existing.thenvoiRoomId, {
    content:
      "[Linear]: Issue unassigned from agent. Disengage from active work and await reassignment.",
    messageType: "task",
    metadata: {
      linear_notification_type: "issueUnassignedFromYou",
      linear_issue_id: notification.issueId,
      linear_actor_id: notification.actorId ?? null,
      linear_bridge: "thenvoi",
    },
  });

  logger.info("linear_thenvoi_bridge.notification_unassigned_handled", {
    issueId: notification.issueId,
    sessionId: existing.linearSessionId,
    roomId: existing.thenvoiRoomId,
  });
}

async function handleIssueNewComment(input: {
  notification: {
    issueId: string;
    commentId: string;
    comment: { body?: string | null };
    actor?: { name?: string | null; displayName?: string | null } | null;
    actorId?: string | null;
  };
  deps: LinearThenvoiBridgeDeps;
  logger: Logger;
}): Promise<void> {
  const { notification, deps, logger } = input;
  const existing = await deps.store.getByIssueId(notification.issueId);

  if (!existing || (existing.status !== "active" && existing.status !== "waiting")) {
    logger.info("linear_thenvoi_bridge.notification_comment_skipped", {
      issueId: notification.issueId,
      reason: existing ? `session_status_${existing.status}` : "no_active_session",
    });
    return;
  }

  const actorName =
    notification.actor?.displayName ?? notification.actor?.name ?? "Unknown user";
  const commentBody = notification.comment.body ?? "";

  await deps.thenvoiRest.createChatEvent(existing.thenvoiRoomId, {
    content: `[Linear Comment from ${actorName}]: ${commentBody}`,
    messageType: "text",
    metadata: {
      linear_notification_type: "issueNewComment",
      linear_issue_id: notification.issueId,
      linear_comment_id: notification.commentId,
      linear_actor_id: notification.actorId ?? null,
      linear_bridge: "thenvoi",
    },
  });

  logger.info("linear_thenvoi_bridge.notification_comment_forwarded", {
    issueId: notification.issueId,
    commentId: notification.commentId,
    sessionId: existing.linearSessionId,
    roomId: existing.thenvoiRoomId,
  });
}

function logReaction(input: {
  notification: {
    __typename?: string;
    issueId?: string;
    actorId?: string | null;
    commentId?: string;
    reactionEmoji?: string;
  };
  logger: Logger;
}): void {
  const { notification, logger } = input;
  logger.info("linear_thenvoi_bridge.notification_reaction", {
    notificationType: notification.__typename,
    issueId: notification.issueId ?? null,
    actorId: notification.actorId ?? null,
    commentId: notification.commentId ?? null,
    reactionEmoji: notification.reactionEmoji ?? null,
  });
}
