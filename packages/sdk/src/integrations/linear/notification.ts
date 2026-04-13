import type { AppUserNotificationWebhookPayloadWithNotification } from "@linear/sdk/webhooks";

import type { Logger } from "../../core/logger";
import type { LinearThenvoiBridgeDeps } from "./types";

/** The notification union carried by AppUserNotificationWebhookPayloadWithNotification. */
type Notification = AppUserNotificationWebhookPayloadWithNotification["notification"];

/** Extract a specific member of the notification union by its __typename discriminant. */
type NotificationByType<T extends NonNullable<Notification["__typename"]>> =
  Extract<Notification, { __typename?: T }>;

const MAX_COMMENT_LENGTH = 4_000;

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
      await handleIssueUnassigned({
        notification: notification as NotificationByType<"IssueUnassignedFromYouNotificationWebhookPayload">,
        deps,
        logger,
      });
      return;
    case "IssueNewCommentNotificationWebhookPayload":
      await handleIssueNewComment({
        notification: notification as NotificationByType<"IssueNewCommentNotificationWebhookPayload">,
        deps,
        logger,
      });
      return;
    case "IssueCommentReactionNotificationWebhookPayload":
    case "IssueEmojiReactionNotificationWebhookPayload":
      logReaction({
        notification: notification as
          | NotificationByType<"IssueCommentReactionNotificationWebhookPayload">
          | NotificationByType<"IssueEmojiReactionNotificationWebhookPayload">,
        logger,
      });
      return;
    default:
      logger.info("linear_thenvoi_bridge.notification_unhandled", {
        notificationType: typename,
      });
  }
}

async function handleIssueUnassigned(input: {
  notification: NotificationByType<"IssueUnassignedFromYouNotificationWebhookPayload">;
  deps: LinearThenvoiBridgeDeps;
  logger: Logger;
}): Promise<void> {
  const { notification, deps, logger } = input;
  // getByIssueId filters out canceled sessions, so retried notifications are naturally idempotent
  const existing = await deps.store.getByIssueId(notification.issueId);

  if (!existing) {
    logger.info("linear_thenvoi_bridge.notification_unassigned_no_session", {
      issueId: notification.issueId,
    });
    return;
  }

  await deps.store.markCanceled(existing.linearSessionId);

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
  notification: NotificationByType<"IssueNewCommentNotificationWebhookPayload">;
  deps: LinearThenvoiBridgeDeps;
  logger: Logger;
}): Promise<void> {
  const { notification, deps, logger } = input;
  // getByIssueId returns the most recent non-canceled session for this issue
  const existing = await deps.store.getByIssueId(notification.issueId);

  if (!existing || (existing.status !== "active" && existing.status !== "waiting")) {
    logger.info("linear_thenvoi_bridge.notification_comment_skipped", {
      issueId: notification.issueId,
      reason: existing ? `session_status_${existing.status}` : "no_active_session",
    });
    return;
  }

  const actorName = notification.actor?.name ?? "Unknown user";
  let commentBody = notification.comment.body ?? "";
  if (commentBody.length > MAX_COMMENT_LENGTH) {
    commentBody = commentBody.slice(0, MAX_COMMENT_LENGTH) + "\u2026";
  }

  if (actorName === "Unknown user") {
    logger.info("linear_thenvoi_bridge.notification_comment_actor_fallback", {
      issueId: notification.issueId,
      commentId: notification.commentId,
      actorId: notification.actorId ?? null,
    });
  }

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
  notification:
    | NotificationByType<"IssueCommentReactionNotificationWebhookPayload">
    | NotificationByType<"IssueEmojiReactionNotificationWebhookPayload">;
  logger: Logger;
}): void {
  const { notification, logger } = input;
  logger.info("linear_thenvoi_bridge.notification_reaction", {
    notificationType: notification.__typename,
    issueId: notification.issueId,
    actorId: notification.actorId ?? null,
    commentId: "commentId" in notification ? notification.commentId : null,
    reactionEmoji: notification.reactionEmoji,
  });
}
