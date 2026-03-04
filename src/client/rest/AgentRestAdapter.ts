/**
 * REST adapter that calls `/api/v1/agent/...` endpoints directly via `fetch`.
 *
 * Agents authenticate with `X-API-Key` and use the `/api/v1/agent/*` namespace.
 */

import type {
  MentionReference,
  MetadataMap,
  PeerRecord,
  ToolOperationResult,
} from "../../contracts/dtos";
import type { RestRequestOptions } from "./requestOptions";
import { DEFAULT_REQUEST_OPTIONS } from "./requestOptions";
import type {
  AgentIdentity,
  ChatParticipant,
  PaginatedResponse,
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
    const controller = new AbortController();
    const timeoutMs = (merged.timeoutInSeconds ?? 30) * 1000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let lastError: Error | undefined;
    const maxRetries = merged.maxRetries ?? 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(this.url(path), {
          method,
          headers: { ...this.headers(), ...merged.headers },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            `${method} /api/v1/agent${path} failed (${response.status}): ${text}`,
          );
        }

        return (await response.json()) as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        }
      }
    }

    clearTimeout(timer);
    throw lastError!;
  }

  private async get<T = unknown>(path: string, options?: RestRequestOptions): Promise<T> {
    return this.request<T>("GET", path, undefined, options);
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
    const params = new URLSearchParams({
      page: String(request.page),
      page_size: String(request.pageSize),
    });
    const json = await this.get<{
      data?: MetadataMap[];
      metadata?: MetadataMap;
    }>(`/chats?${params.toString()}`, options);

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

  // ── Peers ────────────────────────────────────────────────────────────

  public async listPeers(
    request: { page: number; pageSize: number; notInChat: string },
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<PeerRecord>> {
    const params = new URLSearchParams({
      page: String(request.page),
      page_size: String(request.pageSize),
      not_in_chat: request.notInChat,
    });
    const json = await this.get<{
      data?: PeerRecord[];
      metadata?: MetadataMap;
    }>(`/peers?${params.toString()}`, options);

    return {
      data: json.data ?? [],
      metadata: json.metadata,
    };
  }
}
