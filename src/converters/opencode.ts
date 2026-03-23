import { findLatestTaskMetadata } from "../adapters/shared/history";

export interface OpencodeSessionState {
  sessionId: string | null;
  roomId: string | null;
  createdAt: Date | null;
  replayMessages: string[];
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export class OpencodeHistoryConverter {
  public setAgentName(_name: string): void {}

  public convert(raw: Array<Record<string, unknown>>): OpencodeSessionState {
    const replayMessages = buildReplayMessages(raw);
    const metadata = findLatestTaskMetadata(
      raw,
      (entry) => typeof entry.opencode_session_id === "string" && entry.opencode_session_id.length > 0,
    );

    if (!metadata) {
      return {
        sessionId: null,
        roomId: null,
        createdAt: null,
        replayMessages,
      };
    }

    return {
      sessionId: asOptionalString(metadata.opencode_session_id),
      roomId: asOptionalString(metadata.opencode_room_id),
      createdAt: parseDate(metadata.opencode_created_at),
      replayMessages,
    };
  }
}

export function extractOpencodeSessionId(
  raw: Array<Record<string, unknown>>,
): string | null {
  return findLatestTaskMetadata(
    raw,
    (entry) => typeof entry.opencode_session_id === "string" && entry.opencode_session_id.length > 0,
  )?.opencode_session_id as string | null ?? null;
}

function buildReplayMessages(raw: Array<Record<string, unknown>>): string[] {
  const replayMessages: string[] = [];

  for (const entry of raw) {
    if (String(entry.message_type ?? "text") !== "text") {
      continue;
    }

    const content = asOptionalString(entry.content);
    if (!content) {
      continue;
    }

    const senderName = asOptionalString(entry.sender_name)
      ?? asOptionalString(entry.sender_type)
      ?? "Unknown";
    replayMessages.push(`[${senderName}]: ${content}`);
  }

  return replayMessages;
}
