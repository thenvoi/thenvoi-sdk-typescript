import type { HistoryConverter } from "../../contracts/protocols";

export interface ParlantMessage {
  role: "user" | "assistant";
  content: string;
  sender: string;
  senderType: string;
}

export type ParlantMessages = ParlantMessage[];

export class ParlantHistoryConverter
  implements HistoryConverter<ParlantMessages>
{
  public convert(raw: Array<Record<string, unknown>>): ParlantMessages {
    const messages: ParlantMessages = [];

    for (const entry of raw) {
      const messageType = asString(entry.message_type) ?? "text";
      if (messageType !== "text") {
        continue;
      }

      const content = asString(entry.content);
      if (!content) {
        continue;
      }

      const sender =
        asString(entry.sender_name) ??
        asString(entry.senderName) ??
        "";
      const senderType =
        asString(entry.sender_type) ??
        asString(entry.senderType) ??
        "User";
      const role =
        (asString(entry.role) ?? "user").toLowerCase() === "assistant"
          ? "assistant"
          : "user";

      if (role === "assistant") {
        messages.push({
          role,
          content,
          sender,
          senderType,
        });
        continue;
      }

      messages.push({
        role,
        content: sender ? `[${sender}]: ${content}` : content,
        sender,
        senderType,
      });
    }

    return messages;
  }
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
