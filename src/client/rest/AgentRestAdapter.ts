/**
 * REST adapter that calls `/api/v1/agent/...` endpoints directly via `fetch`.
 *
 * Agents authenticate with `X-API-Key` and use the `/api/v1/agent/*` namespace.
 */

import type {
  ContactRequestAction,
  ContactRequestsResult,
  ContactRecord,
  ListMemoriesArgs,
  MemoryRecord,
  MentionReference,
  MetadataMap,
  PeerRecord,
  StoreMemoryArgs,
  ToolOperationResult,
} from "../../contracts/dtos";
import type { RestRequestOptions } from "./requestOptions";
import { DEFAULT_REQUEST_OPTIONS } from "./requestOptions";
import type {
  AgentIdentity,
  ChatParticipant,
  PaginatedResponse,
  PlatformChatMessage,
  RestApi,
} from "./types";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface AgentRestAdapterOptions {
  /** Base URL of the Thenvoi platform (e.g. "https://app.thenvoi.com"). */
  baseUrl: string;
  /** Agent API key (thnv_a_...). Sent as X-API-Key header. */
  apiKey: string;
}

const DEFAULT_TIMEOUT_SECONDS = 30;
const BASE_RETRY_DELAY_MS = 200;
const MAX_RETRY_DELAY_MS = 2_000;
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429]);

class RestRequestError extends Error {
  public readonly retryable: boolean;

  public constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "RestRequestError";
    this.retryable = retryable;
  }
}

function serializeRequestBody(method: string, path: string, body: unknown): string | undefined {
  if (body === undefined) {
    return undefined;
  }

  try {
    return JSON.stringify(body);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new RestRequestError(
      `Failed to serialize ${method} /api/v1/agent${path} request body: ${detail}`,
      false,
    );
  }
}

async function parseJsonResponse<T>(
  response: Response,
  method: string,
  path: string,
): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new RestRequestError(
      `${method} /api/v1/agent${path} returned invalid JSON: ${detail}`,
      false,
    );
  }
}

function buildHttpError(
  method: string,
  path: string,
  response: Response,
): RestRequestError {
  const retryable = response.status >= 500 || RETRYABLE_STATUS_CODES.has(response.status);
  const contentType = response.headers.get("content-type");
  const contentTypeHint = contentType ? `; content-type=${contentType}` : "";
  return new RestRequestError(
    `${method} /api/v1/agent${path} failed (${response.status}; response body omitted${contentTypeHint})`,
    retryable,
  );
}

function normalizeRequestError(
  error: unknown,
  method: string,
  path: string,
  timeoutMs: number,
  didTimeout: boolean,
): RestRequestError {
  if (error instanceof RestRequestError) {
    return error;
  }

  if (didTimeout) {
    return new RestRequestError(
      `${method} /api/v1/agent${path} timed out after ${timeoutMs}ms`,
      true,
    );
  }

  const detail = error instanceof Error ? error.message : String(error);
  return new RestRequestError(
    `${method} /api/v1/agent${path} request failed: ${detail}`,
    true,
  );
}

function nextRetryDelayMs(attempt: number): number {
  const baseDelay = Math.min(BASE_RETRY_DELAY_MS * (2 ** attempt), MAX_RETRY_DELAY_MS);
  const jitter = 0.5 + Math.random();
  return Math.round(baseDelay * jitter);
}

function withQuery(path: string, values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && value.length > 0) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Direct-fetch implementation of `/api/v1/agent/*` REST endpoints.
 */
export class AgentRestAdapter implements RestApi {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  public constructor(options: AgentRestAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      "X-API-Key": this.apiKey,
      "Content-Type": "application/json",
    };
  }

  private url(path: string): string {
    return `${this.baseUrl}/api/v1/agent${path}`;
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    options?: RestRequestOptions,
  ): Promise<T> {
    const merged = { ...DEFAULT_REQUEST_OPTIONS, ...options };
    const timeoutMs = (merged.timeoutInSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
    const maxRetries = merged.maxRetries ?? 0;
    const requestBody = serializeRequestBody(method, path, body);
    let lastError = new RestRequestError(
      `${method} /api/v1/agent${path} failed without returning an error.`,
      false,
    );

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(this.url(path), {
          method,
          headers: { ...this.headers(), ...merged.headers },
          body: requestBody,
          signal: controller.signal,
        });

        if (!response.ok) {
          throw buildHttpError(method, path, response);
        }

        return await parseJsonResponse<T>(response, method, path);
      } catch (err) {
        lastError = normalizeRequestError(err, method, path, timeoutMs, controller.signal.aborted);
        if (attempt >= maxRetries || !lastError.retryable) {
          throw lastError;
        }
      } finally {
        clearTimeout(timer);
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, nextRetryDelayMs(attempt));
      });
    }

    throw lastError;
  }

  private async get<T = unknown>(path: string, options?: RestRequestOptions): Promise<T> {
    return this.request<T>("GET", path, undefined, options);
  }

  private async getOptional<T = unknown>(path: string, options?: RestRequestOptions): Promise<T | null> {
    const merged = { ...DEFAULT_REQUEST_OPTIONS, ...options };
    const timeoutMs = (merged.timeoutInSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
    const maxRetries = merged.maxRetries ?? 0;
    let lastError = new RestRequestError(
      `GET /api/v1/agent${path} failed without returning an error.`,
      false,
    );

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(this.url(path), {
          method: "GET",
          headers: { ...this.headers(), ...merged.headers },
          signal: controller.signal,
        });

        if (response.status === 204) {
          return null;
        }

        if (!response.ok) {
          throw buildHttpError("GET", path, response);
        }

        return await parseJsonResponse<T>(response, "GET", path);
      } catch (error) {
        lastError = normalizeRequestError(error, "GET", path, timeoutMs, controller.signal.aborted);
        if (attempt >= maxRetries || !lastError.retryable) {
          throw lastError;
        }
      } finally {
        clearTimeout(timer);
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, nextRetryDelayMs(attempt));
      });
    }

    throw lastError;
  }

  private async post<T = unknown>(path: string, body?: unknown, options?: RestRequestOptions): Promise<T> {
    return this.request<T>("POST", path, body, options);
  }

  private async del<T = unknown>(path: string, options?: RestRequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, undefined, options);
  }

  // ── Identity ─────────────────────────────────────────────────────────

  public async getAgentMe(options?: RestRequestOptions): Promise<AgentIdentity> {
    const json = await this.get<{ data?: { id?: string; name?: string; description?: string | null } }>(
      "/me",
      options,
    );
    const data = json.data;
    if (!data?.id || !data?.name) {
      throw new Error(`Unexpected /api/v1/agent/me response: ${JSON.stringify(json)}`);
    }
    return { id: data.id, name: data.name, description: data.description ?? null };
  }

  // ── Chats ────────────────────────────────────────────────────────────

  public async createChat(taskId?: string, options?: RestRequestOptions): Promise<{ id: string }> {
    const json = await this.post<{ data?: { id?: string } }>(
      "/chats",
      { chat: { task_id: taskId } },
      options,
    );
    const id = json.data?.id;
    if (!id) {
      throw new Error(`Chat create response did not include id: ${JSON.stringify(json)}`);
    }
    return { id };
  }

  public async listChats(
    request: { page: number; pageSize: number },
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse> {
    const json = await this.get<{
      data?: MetadataMap[];
      metadata?: MetadataMap;
    }>(withQuery("/chats", {
      page: String(request.page),
      page_size: String(request.pageSize),
    }), options);

    return {
      data: json.data ?? [],
      metadata: json.metadata,
    };
  }

  public async listContacts(
    request: { page: number; pageSize: number },
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<ContactRecord>> {
    const json = await this.get<{
      data?: ContactRecord[];
      metadata?: MetadataMap;
    }>(withQuery("/contacts", {
      page: String(request.page),
      page_size: String(request.pageSize),
    }), options);

    return {
      data: json.data ?? [],
      metadata: json.metadata,
    };
  }

  public async addContact(
    handle: string,
    message?: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    const json = await this.post<{ data?: ToolOperationResult }>(
      "/contacts/add",
      { handle, ...(message ? { message } : {}) },
      options,
    );
    return json.data ?? {};
  }

  public async removeContact(
    request: { handle?: string; contactId?: string },
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    const json = await this.post<{ data?: ToolOperationResult }>(
      "/contacts/remove",
      {
        ...(request.handle ? { handle: request.handle } : {}),
        ...(request.contactId ? { contact_id: request.contactId } : {}),
      },
      options,
    );
    return json.data ?? {};
  }

  public async listContactRequests(
    request: { page: number; pageSize: number; sentStatus: string },
    options?: RestRequestOptions,
  ): Promise<ContactRequestsResult> {
    const json = await this.get<{
      data?: {
        received?: ContactRequestsResult["received"];
        sent?: ContactRequestsResult["sent"];
      };
      metadata?: MetadataMap;
    }>(withQuery("/contacts/requests", {
      page: String(request.page),
      page_size: String(request.pageSize),
      sent_status: request.sentStatus,
    }), options);

    return {
      received: json.data?.received ?? [],
      sent: json.data?.sent ?? [],
      metadata: json.metadata,
    };
  }

  public async respondContactRequest(
    request: { action: ContactRequestAction; handle?: string; requestId?: string },
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    const json = await this.post<{ data?: ToolOperationResult }>(
      "/contacts/requests/respond",
      {
        action: request.action,
        ...(request.handle ? { handle: request.handle } : {}),
        ...(request.requestId ? { request_id: request.requestId } : {}),
      },
      options,
    );
    return json.data ?? {};
  }

  public async listMemories(
    request: ListMemoriesArgs,
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<MemoryRecord>> {
    const json = await this.get<{
      data?: MemoryRecord[];
      meta?: MetadataMap;
    }>(withQuery("/memories", {
      subject_id: typeof request.subject_id === "string" ? request.subject_id : undefined,
      scope: typeof request.scope === "string" ? request.scope : undefined,
      system: typeof request.system === "string" ? request.system : undefined,
      type: typeof request.type === "string" ? request.type : undefined,
      segment: typeof request.segment === "string" ? request.segment : undefined,
      content_query: typeof request.content_query === "string" ? request.content_query : undefined,
      page_size: typeof request.page_size === "number" ? String(request.page_size) : undefined,
      status: typeof request.status === "string" ? request.status : undefined,
    }), options);

    return {
      data: json.data ?? [],
      metadata: json.meta,
    };
  }

  public async storeMemory(
    request: StoreMemoryArgs,
    options?: RestRequestOptions,
  ): Promise<MemoryRecord> {
    const json = await this.post<{ data?: MemoryRecord }>(
      "/memories",
      { memory: request },
      options,
    );
    return json.data ?? {};
  }

  public async getMemory(memoryId: string, options?: RestRequestOptions): Promise<MemoryRecord> {
    const json = await this.get<{ data?: MemoryRecord }>(`/memories/${memoryId}`, options);
    return json.data ?? {};
  }

  public async supersedeMemory(
    memoryId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    const json = await this.post<{ data?: MemoryRecord }>(
      `/memories/${memoryId}/supersede`,
      {},
      options,
    );
    const data = json.data;
    return {
      id: data?.id,
      status: data?.status,
    };
  }

  public async archiveMemory(
    memoryId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    const json = await this.post<{ data?: MemoryRecord }>(
      `/memories/${memoryId}/archive`,
      {},
      options,
    );
    const data = json.data;
    return {
      id: data?.id,
      status: data?.status,
    };
  }

  public async getChatContext(
    request: { chatId: string; page?: number; pageSize?: number },
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<PlatformChatMessage>> {
    const json = await this.get<{
      data?: PlatformChatMessage[];
      meta?: MetadataMap;
    }>(withQuery(`/chats/${request.chatId}/context`, {
      page: typeof request.page === "number" ? String(request.page) : undefined,
      page_size: typeof request.pageSize === "number" ? String(request.pageSize) : undefined,
    }), options);

    return {
      data: json.data ?? [],
      metadata: json.meta,
    };
  }

  public async listMessages(
    request: { chatId: string; page: number; pageSize: number; status?: string },
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<PlatformChatMessage>> {
    const json = await this.get<{
      data?: PlatformChatMessage[];
      metadata?: MetadataMap;
    }>(withQuery(`/chats/${request.chatId}/messages`, {
      page: String(request.page),
      page_size: String(request.pageSize),
      status: request.status,
    }), options);

    return {
      data: json.data ?? [],
      metadata: json.metadata,
    };
  }

  public async getNextMessage(
    request: { chatId: string },
    options?: RestRequestOptions,
  ): Promise<PlatformChatMessage | null> {
    const json = await this.getOptional<{ data?: PlatformChatMessage }>(
      `/chats/${request.chatId}/messages/next`,
      options,
    );

    return json?.data ?? null;
  }

  // ── Peers ────────────────────────────────────────────────────────────

  public async listPeers(
    request: { page: number; pageSize: number; notInChat: string },
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<PeerRecord>> {
    const json = await this.get<{
      data?: PeerRecord[];
      metadata?: MetadataMap;
    }>(withQuery("/peers", {
      page: String(request.page),
      page_size: String(request.pageSize),
      not_in_chat: request.notInChat,
    }), options);

    return {
      data: json.data ?? [],
      metadata: json.metadata,
    };
  }

  // ── Messages ─────────────────────────────────────────────────────────

  public async createChatMessage(
    chatId: string,
    message: {
      content: string;
      messageType?: string;
      metadata?: MetadataMap;
      mentions?: MentionReference[];
    },
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    // Agent message endpoint only accepts `content` and `mentions`.
    const body: Record<string, unknown> = {
      content: message.content,
      mentions: message.mentions ?? [],
    };

    return this.post<ToolOperationResult>(
      `/chats/${chatId}/messages`,
      { message: body },
      options,
    );
  }

  public async createChatEvent(
    chatId: string,
    event: {
      content: string;
      messageType: string;
      metadata?: MetadataMap;
    },
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    return this.post<ToolOperationResult>(
      `/chats/${chatId}/events`,
      {
        event: {
          content: event.content,
          message_type: event.messageType,
          metadata: event.metadata,
        },
      },
      options,
    );
  }

  // ── Message lifecycle ────────────────────────────────────────────────

  public async markMessageProcessing(
    chatId: string,
    messageId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    return this.post<ToolOperationResult>(
      `/chats/${chatId}/messages/${messageId}/processing`,
      {},
      options,
    );
  }

  public async markMessageProcessed(
    chatId: string,
    messageId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    return this.post<ToolOperationResult>(
      `/chats/${chatId}/messages/${messageId}/processed`,
      {},
      options,
    );
  }

  public async markMessageFailed(
    chatId: string,
    messageId: string,
    error: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    return this.post<ToolOperationResult>(
      `/chats/${chatId}/messages/${messageId}/failed`,
      { error },
      options,
    );
  }

  // ── Participants ─────────────────────────────────────────────────────

  public async listChatParticipants(
    chatId: string,
    options?: RestRequestOptions,
  ): Promise<ChatParticipant[]> {
    const json = await this.get<{ data?: ChatParticipant[] }>(
      `/chats/${chatId}/participants`,
      options,
    );
    return json.data ?? [];
  }

  public async addChatParticipant(
    chatId: string,
    participant: { participantId: string; role: string },
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    return this.post<ToolOperationResult>(
      `/chats/${chatId}/participants`,
      {
        participant: {
          participant_id: participant.participantId,
          role: participant.role,
        },
      },
      options,
    );
  }

  public async removeChatParticipant(
    chatId: string,
    participantId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    return this.del<ToolOperationResult>(
      `/chats/${chatId}/participants/${participantId}`,
      options,
    );
  }

}
