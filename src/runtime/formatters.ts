export function replaceUuidMentions(
  content: string,
  participants: Array<Record<string, unknown>>,
): string {
  if (!content || participants.length === 0) {
    return content;
  }

  let next = content;
  for (const participant of participants) {
    const participantId = participant.id;
    const handle = participant.handle;
    if (typeof participantId === "string" && typeof handle === "string") {
      next = next.replaceAll(`@[[${participantId}]]`, `@${handle}`);
    }
  }

  return next;
}

export function formatMessageForLlm(
  message: Record<string, unknown>,
  participants?: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const senderType = String(message.sender_type ?? "");
  const senderName = String(message.sender_name ?? message.name ?? senderType);
  const content = participants
    ? replaceUuidMentions(String(message.content ?? ""), participants)
    : String(message.content ?? "");

  return {
    role: senderType === "Agent" ? "assistant" : "user",
    content,
    sender_name: senderName,
    sender_type: senderType,
    message_type: String(message.message_type ?? "text"),
    metadata:
      typeof message.metadata === "object" && message.metadata !== null
        ? (message.metadata as Record<string, unknown>)
        : {},
  };
}

export function formatHistoryForLlm(
  messages: Array<Record<string, unknown>>,
  options?: {
    excludeId?: string;
    participants?: Array<Record<string, unknown>>;
  },
): Array<Record<string, unknown>> {
  const excludeId = options?.excludeId;
  const participants = options?.participants;

  return messages
    .filter((message) => String(message.id ?? "") !== excludeId)
    .map((message) => formatMessageForLlm(message, participants));
}

export function buildParticipantsMessage(participants: Array<Record<string, unknown>>): string {
  if (participants.length === 0) {
    return "## Current Participants\nNo other participants in this room.";
  }

  const lines = ["## Current Participants"];
  for (const participant of participants) {
    const participantType = String(participant.type ?? "Unknown");
    const participantName = String(participant.name ?? "Unknown");
    const participantHandle = String(participant.handle ?? "Unknown");
    lines.push(`- @${participantHandle} — ${participantName} (${participantType})`);
  }

  lines.push("");
  lines.push(
    "IMPORTANT: In thenvoi_send_message mentions, always use the exact handle shown above (e.g. '@john' for users, '@john/weather-agent' for agents), NOT the display name. Handles are lowercase with no spaces.",
  );

  return lines.join("\n");
}
