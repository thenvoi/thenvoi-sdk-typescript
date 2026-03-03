import type { HistoryConverter } from "../../contracts/protocols";
import { findLatestTaskMetadata } from "../shared/history";

export interface A2AAuth {
  apiKey?: string;
  bearerToken?: string;
  headers?: Record<string, string>;
}

export interface A2ASessionState {
  contextId: string | null;
  taskId: string | null;
  taskState: string | null;
}

export function buildA2AAuthHeaders(auth?: A2AAuth): Record<string, string> {
  const headers: Record<string, string> = {
    ...(auth?.headers ?? {}),
  };

  if (auth?.apiKey) {
    headers["X-API-Key"] = auth.apiKey;
  }

  if (auth?.bearerToken) {
    headers.Authorization = `Bearer ${auth.bearerToken}`;
  }

  return headers;
}

export class A2AHistoryConverter implements HistoryConverter<A2ASessionState> {
  public convert(raw: Array<Record<string, unknown>>): A2ASessionState {
    const metadata = findLatestTaskMetadata(
      raw,
      (entry) => Object.prototype.hasOwnProperty.call(entry, "a2a_context_id"),
    );
    if (metadata) {
      return {
        contextId: asNullableString(metadata.a2a_context_id),
        taskId: asNullableString(metadata.a2a_task_id),
        taskState: asNullableString(metadata.a2a_task_state),
      };
    }

    return {
      contextId: null,
      taskId: null,
      taskState: null,
    };
  }
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  return value;
}
