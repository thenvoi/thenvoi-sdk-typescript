import type { HistoryProvider } from "../../runtime/types";

interface BuildConversationPromptOptions {
  history: HistoryProvider;
  isSessionBootstrap: boolean;
  participantsMessage: string | null;
  contactsMessage: string | null;
  historyHeader: string;
  currentMessage: string;
  maxHistoryMessages?: number;
}

export function buildConversationPrompt(options: BuildConversationPromptOptions): string {
  const parts: string[] = [];

  if (options.isSessionBootstrap && options.history.length > 0) {
    const historyText = options.history.raw
      .slice(-(options.maxHistoryMessages ?? 50))
      .map(formatHistoryLine)
      .join("\n");
    parts.push(`${options.historyHeader}\n${historyText}`);
  }

  if (options.participantsMessage) {
    parts.push(`[System]: ${options.participantsMessage}`);
  }

  if (options.contactsMessage) {
    parts.push(`[System]: ${options.contactsMessage}`);
  }

  parts.push(options.currentMessage);
  return parts.join("\n\n");
}

function formatHistoryLine(entry: Record<string, unknown>): string {
  const sender = String(entry.sender_name ?? entry.sender_type ?? "Unknown");
  const content = String(entry.content ?? "");
  return `[${sender}]: ${content}`;
}
