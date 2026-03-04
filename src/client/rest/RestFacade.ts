import { UnsupportedFeatureError } from "../../core/errors";
import type { Logger } from "../../core/logger";
import { NoopLogger } from "../../core/logger";
import type {
  MentionReference,
  MetadataMap,
  PeerRecord,
  ToolOperationResult,
} from "../../contracts/dtos";
import { DEFAULT_REQUEST_OPTIONS, type RestRequestOptions } from "./requestOptions";
import { fetchPaginated, normalizePaginationMetadata, type PaginationOptions } from "./pagination";
import type {
  FernThenvoiClientLike,
  RestApi,
  AgentIdentity,
  ChatParticipant,
  PaginatedResponse,
} from "./types";

function mergeOptions(options?: RestRequestOptions): RestRequestOptions {
  return {
    ...DEFAULT_REQUEST_OPTIONS,
    ...options,
  };
}

function unwrapData<T>(value: T | { data?: T }): T {
  if (value && typeof value === "object" && "data" in value) {
    const data = value.data;
    if (data !== undefined) {
      return data;
    }
  }

  return value as T;
}

export class FernRestAdapter implements RestApi {
  private readonly client: FernThenvoiClientLike;

  public constructor(client: FernThenvoiClientLike) {
    this.client = client;
  }

  public async getAgentMe(options?: RestRequestOptions): Promise<AgentIdentity> {
    if (!this.client.myProfile?.getMyProfile) {
      throw new UnsupportedFeatureError("Fern client missing myProfile.getMyProfile");
    }

    const profile = await this.client.myProfile.getMyProfile(mergeOptions(options));
    const name = profile.name
      ?? ([profile.first_name, profile.last_name].filter(Boolean).join(" ") || undefined)
      ?? profile.username
      ?? profile.id;
    return {
      id: profile.id,
      name,
      description: profile.description ?? null,
    };
  }

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
    const api = this.client.chatMessages?.createChatMessage ?? this.client.myChatMessages?.createMyChatMessage;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing chat message creation endpoint");
    }

    return api(
      chatId,
      {
        message: {
          content: message.content,
          message_type: message.messageType,
          metadata: message.metadata,
          mentions: message.mentions,
        },
      },
      mergeOptions(options),
    ) as Promise<ToolOperationResult>;
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
    return this.createChatMessage(
      chatId,
      {
        content: event.content,
        messageType: event.messageType,
        metadata: event.metadata,
      },
      options,
    );
  }

  public async createChat(taskId?: string, options?: RestRequestOptions): Promise<{ id: string }> {
    if (!this.client.chatRooms?.createChat) {
      throw new UnsupportedFeatureError("Fern client missing chatRooms.createChat");
    }

    const response = await this.client.chatRooms.createChat(
      {
        chat: {
          task_id: taskId,
        },
      },
      mergeOptions(options),
    );

    const room = unwrapData(response) as { id?: string };
    if (!room.id) {
      throw new UnsupportedFeatureError("Chat create response did not include id");
    }

    return { id: room.id };
  }

  public async listChatParticipants(
    chatId: string,
    options?: RestRequestOptions,
  ): Promise<ChatParticipant[]> {
    if (!this.client.chatParticipants?.listChatParticipants) {
      throw new UnsupportedFeatureError("Fern client missing chatParticipants.listChatParticipants");
    }

    const response = await this.client.chatParticipants.listChatParticipants(
      chatId,
      {},
      mergeOptions(options),
    );
    return unwrapData(response) as ChatParticipant[];
  }

  public async addChatParticipant(
    chatId: string,
    participant: { participantId: string; role: string },
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    if (!this.client.chatParticipants?.addChatParticipant) {
      throw new UnsupportedFeatureError("Fern client missing chatParticipants.addChatParticipant");
    }

    return this.client.chatParticipants.addChatParticipant(
      chatId,
      {
        participant: {
          participant_id: participant.participantId,
          role: participant.role,
        },
      },
      mergeOptions(options),
    ) as Promise<ToolOperationResult>;
  }

  public async removeChatParticipant(
    chatId: string,
    participantId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    if (!this.client.chatParticipants?.removeChatParticipant) {
      throw new UnsupportedFeatureError("Fern client missing chatParticipants.removeChatParticipant");
    }

    return this.client.chatParticipants.removeChatParticipant(
      chatId, participantId, mergeOptions(options),
    ) as Promise<ToolOperationResult>;
  }

  public async markMessageProcessing(
    chatId: string,
    messageId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    if (!this.client.chatMessages?.markMessageProcessing) {
      throw new UnsupportedFeatureError("Fern client missing chatMessages.markMessageProcessing");
    }

    return this.client.chatMessages.markMessageProcessing(
      chatId, messageId, mergeOptions(options),
    ) as Promise<ToolOperationResult>;
  }

  public async markMessageProcessed(
    chatId: string,
    messageId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    if (!this.client.chatMessages?.markMessageProcessed) {
      throw new UnsupportedFeatureError("Fern client missing chatMessages.markMessageProcessed");
    }

    return this.client.chatMessages.markMessageProcessed(
      chatId, messageId, mergeOptions(options),
    ) as Promise<ToolOperationResult>;
  }

  public async markMessageFailed(
    chatId: string,
    messageId: string,
    error: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    if (!this.client.chatMessages?.markMessageFailed) {
      throw new UnsupportedFeatureError("Fern client missing chatMessages.markMessageFailed");
    }

    return this.client.chatMessages.markMessageFailed(
      chatId,
      messageId,
      { error },
      mergeOptions(options),
    ) as Promise<ToolOperationResult>;
  }

  public async listPeers(): Promise<{ data: PeerRecord[]; metadata?: MetadataMap }> {
    throw new UnsupportedFeatureError(
      "Peer listing is not yet available in this SDK version",
    );
  }

  public async listChats(
    request: { page: number; pageSize: number },
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<MetadataMap>> {
    if (!this.client.chatRooms?.listChats) {
      throw new UnsupportedFeatureError("Fern client missing chatRooms.listChats");
    }

    const response = await this.client.chatRooms.listChats(
      {
        page: request.page,
        page_size: request.pageSize,
      },
      mergeOptions(options),
    );

    if (Array.isArray(response)) {
      return { data: response as MetadataMap[] };
    }

    const topLevel = response as MetadataMap;
    const topLevelData = topLevel.data;

    if (Array.isArray(topLevelData)) {
      return {
        data: topLevelData as MetadataMap[],
        metadata: normalizePaginationMetadata(
          typeof topLevel.metadata === "object" && topLevel.metadata !== null
            ? (topLevel.metadata as MetadataMap)
            : undefined,
        ),
      };
    }

    if (topLevelData && typeof topLevelData === "object") {
      const nested = topLevelData as MetadataMap;
      if (Array.isArray(nested.data)) {
        return {
          data: nested.data as MetadataMap[],
          metadata: normalizePaginationMetadata(
            typeof nested.metadata === "object" && nested.metadata !== null
              ? (nested.metadata as MetadataMap)
              : undefined,
          ),
        };
      }
    }

    return { data: [] };
  }
}

export interface RestFacadeOptions {
  api: RestApi;
  logger?: Logger;
}

type ListAllChatsOptions = PaginationOptions;

export class RestFacade implements RestApi {
  private readonly api: RestApi;
  private readonly logger: Logger;

  public constructor(options: RestFacadeOptions) {
    this.api = options.api;
    this.logger = options.logger ?? new NoopLogger();
  }

  public getAgentMe(options?: RestRequestOptions): Promise<AgentIdentity> {
    return this.forward("getAgentMe", () => this.api.getAgentMe(options));
  }

  public createChatMessage(
    chatId: string,
    message: {
      content: string;
      messageType?: string;
      metadata?: MetadataMap;
      mentions?: MentionReference[];
    },
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    return this.forward("createChatMessage", () => this.api.createChatMessage(chatId, message, options), {
      chatId,
    });
  }

  public createChatEvent(
    chatId: string,
    event: {
      content: string;
      messageType: string;
      metadata?: MetadataMap;
    },
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    return this.forward("createChatEvent", () => this.api.createChatEvent(chatId, event, options), {
      chatId,
      messageType: event.messageType,
    });
  }

  public createChat(taskId?: string, options?: RestRequestOptions): Promise<{ id: string }> {
    return this.forward("createChat", () => this.api.createChat(taskId, options), {
      hasTaskId: Boolean(taskId),
    });
  }

  public listChatParticipants(chatId: string, options?: RestRequestOptions): Promise<ChatParticipant[]> {
    return this.forward("listChatParticipants", () => this.api.listChatParticipants(chatId, options), {
      chatId,
    });
  }

  public addChatParticipant(
    chatId: string,
    participant: { participantId: string; role: string },
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    return this.forward(
      "addChatParticipant",
      () => this.api.addChatParticipant(chatId, participant, options),
      { chatId, participantId: participant.participantId },
    );
  }

  public removeChatParticipant(
    chatId: string,
    participantId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    return this.forward(
      "removeChatParticipant",
      () => this.api.removeChatParticipant(chatId, participantId, options),
      { chatId, participantId },
    );
  }

  public markMessageProcessing(
    chatId: string,
    messageId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    return this.forward(
      "markMessageProcessing",
      () => this.api.markMessageProcessing(chatId, messageId, options),
      { chatId, messageId },
    );
  }

  public markMessageProcessed(
    chatId: string,
    messageId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    return this.forward(
      "markMessageProcessed",
      () => this.api.markMessageProcessed(chatId, messageId, options),
      { chatId, messageId },
    );
  }

  public markMessageFailed(
    chatId: string,
    messageId: string,
    error: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    return this.forward(
      "markMessageFailed",
      () => this.api.markMessageFailed(chatId, messageId, error, options),
      { chatId, messageId },
    );
  }

  public listPeers(
    request: { page: number; pageSize: number; notInChat: string },
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<PeerRecord>> {
    return this.forward("listPeers", async () => {
      if (!this.api.listPeers) {
        throw new UnsupportedFeatureError("Peer listing is not available in current REST adapter");
      }

      const response = await this.api.listPeers(request, options);
      return {
        data: response.data,
        metadata: normalizePaginationMetadata(response.metadata),
      };
    }, request);
  }

  public async listChats(
    request: { page: number; pageSize: number },
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<MetadataMap>> {
    this.logger.debug("REST listChats", request);
    if (!this.api.listChats) {
      throw new UnsupportedFeatureError("Chat listing is not available in current REST adapter");
    }

    return this.api.listChats(request, options);
  }

  public async listAllChats(
    options?: ListAllChatsOptions,
    requestOptions?: RestRequestOptions,
  ): Promise<MetadataMap[]> {
    return fetchPaginated({
      fetchPage: ({ page, pageSize }) => this.listChats({ page, pageSize }, requestOptions),
      pageSize: options?.pageSize,
      maxPages: options?.maxPages,
      strategy: options?.strategy,
      metadataValidation: options?.metadataValidation,
    });
  }

  private forward<T>(
    operation: string,
    call: () => Promise<T>,
    metadata?: MetadataMap,
  ): Promise<T> {
    this.logger.debug(`REST ${operation}`, metadata);
    return call();
  }
}
