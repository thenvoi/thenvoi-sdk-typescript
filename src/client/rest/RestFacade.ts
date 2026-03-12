import { UnsupportedFeatureError } from "../../core/errors";
import type { Logger } from "../../core/logger";
import { NoopLogger } from "../../core/logger";
import { asNullableString, asOptionalRecord, asString } from "../../adapters/shared/coercion";
import type {
  AddContactArgs,
  ContactRecord,
  ContactRequestsResult,
  ListContactRequestsArgs,
  ListContactsArgs,
  ListMemoriesArgs,
  MemoryRecord,
  MentionReference,
  MetadataMap,
  PeerRecord,
  RemoveContactArgs,
  RespondContactRequestArgs,
  StoreMemoryArgs,
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
  PlatformChatMessage,
} from "./types";

function mergeOptions(options?: RestRequestOptions): RestRequestOptions {
  return {
    ...DEFAULT_REQUEST_OPTIONS,
    ...options,
  };
}

function unwrapData<T>(value: unknown): T {
  const record = asMetadataMap(value);
  if (record?.data !== undefined) {
    return record.data as T;
  }

  return value as T;
}

function asMetadataMap(value: unknown): MetadataMap | undefined {
  return asOptionalRecord(value) as MetadataMap | undefined;
}

function asRecordArray<T = MetadataMap>(value: unknown): T[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((entry): entry is T => asOptionalRecord(entry) !== undefined);
}

function extractEnvelopeData(value: unknown): unknown {
  const record = asMetadataMap(value);
  if (!record || record.data === undefined) {
    return value;
  }

  return record.data;
}

function extractEnvelopeMetadata(value: unknown): MetadataMap | undefined {
  const record = asMetadataMap(value);
  if (!record) {
    return undefined;
  }

  return asMetadataMap(record.metadata) ?? asMetadataMap(record.meta);
}

function normalizePaginatedResponse<T = MetadataMap>(
  response: unknown,
): PaginatedResponse<T> {
  const topLevelData = extractEnvelopeData(response);
  const nestedData = extractEnvelopeData(topLevelData);

  return {
    data: asRecordArray<T>(topLevelData) ?? asRecordArray<T>(nestedData) ?? [],
    metadata: normalizePaginationMetadata(
      extractEnvelopeMetadata(response) ?? extractEnvelopeMetadata(topLevelData),
    ),
  };
}

function normalizeContactRequestDirection(value: unknown): MetadataMap | undefined {
  const direction = asMetadataMap(value);
  if (!direction) {
    return undefined;
  }

  return {
    ...direction,
    totalPages:
      typeof direction.totalPages === "number"
        ? direction.totalPages
        : typeof direction.total_pages === "number"
          ? direction.total_pages
          : undefined,
  };
}

function normalizeContactRequestsResult(result: ContactRequestsResult): ContactRequestsResult {
  const metadata = asMetadataMap(result.metadata);
  return {
    received: Array.isArray(result.received) ? result.received : [],
    sent: Array.isArray(result.sent) ? result.sent : [],
    metadata: metadata
      ? {
        ...metadata,
        page:
          typeof metadata.page === "number"
            ? metadata.page
            : typeof metadata.page_number === "number"
              ? metadata.page_number
              : undefined,
        pageSize:
          typeof metadata.pageSize === "number"
            ? metadata.pageSize
            : typeof metadata.page_size === "number"
              ? metadata.page_size
              : undefined,
        received: normalizeContactRequestDirection(metadata.received),
        sent: normalizeContactRequestDirection(metadata.sent),
      }
      : undefined,
  };
}

function normalizeContactRequestsResponse(response: unknown): ContactRequestsResult {
  const payload = asMetadataMap(extractEnvelopeData(response));
  return normalizeContactRequestsResult({
    received: asRecordArray(payload?.received) ?? [],
    sent: asRecordArray(payload?.sent) ?? [],
    metadata: extractEnvelopeMetadata(response) ?? extractEnvelopeMetadata(payload),
  });
}

function normalizeToolOperationResult(response: unknown): ToolOperationResult {
  return asMetadataMap(extractEnvelopeData(response)) ?? {};
}

function normalizeMemoryRecord(response: unknown): MemoryRecord {
  return asMetadataMap(extractEnvelopeData(response)) ?? {};
}

function extractChatId(response: unknown): string | undefined {
  const payload = asMetadataMap(extractEnvelopeData(response));
  return typeof payload?.id === "string" ? payload.id : undefined;
}

function isChatParticipant(value: unknown): value is ChatParticipant {
  const record = asMetadataMap(value);
  if (!record) {
    return false;
  }

  return typeof record.id === "string"
    && typeof record.name === "string"
    && typeof record.type === "string"
    && (record.handle === undefined || record.handle === null || typeof record.handle === "string");
}

function normalizeChatParticipantsResponse(response: unknown): ChatParticipant[] {
  const payload = extractEnvelopeData(response);
  return Array.isArray(payload) ? payload.filter(isChatParticipant) : [];
}

function normalizePlatformChatMessage(value: unknown): PlatformChatMessage | null {
  const payload = asMetadataMap(value);
  if (!payload) {
    return null;
  }

  const id = asString(payload.id);
  const content = asString(payload.content);
  const senderId = asString(payload.sender_id) ?? asString(payload.senderId);
  const senderType = asString(payload.sender_type) ?? asString(payload.senderType);
  const messageType = asString(payload.message_type) ?? asString(payload.messageType);
  const insertedAt = asString(payload.inserted_at) ?? asString(payload.insertedAt);
  if (!id || !content || !senderId || !senderType || !messageType || !insertedAt) {
    return null;
  }

  const senderName = asNullableString(payload.sender_name ?? payload.senderName);
  const updatedAt = asNullableString(payload.updated_at ?? payload.updatedAt);
  const metadata = payload.metadata === null ? null : asMetadataMap(payload.metadata);

  return {
    id,
    content,
    sender_id: senderId,
    sender_type: senderType,
    sender_name: senderName,
    message_type: messageType,
    metadata: payload.metadata === null ? null : metadata,
    inserted_at: insertedAt,
    updated_at: updatedAt,
  };
}

export class FernRestAdapter implements RestApi {
  private readonly client: FernThenvoiClientLike;

  public constructor(client: FernThenvoiClientLike) {
    this.client = client;
  }

  public async getAgentMe(options?: RestRequestOptions): Promise<AgentIdentity> {
    if (this.client.agentApiIdentity?.getAgentMe) {
      const profile = unwrapData<AgentIdentity>(await this.client.agentApiIdentity.getAgentMe(mergeOptions(options)));
      return {
        id: profile.id,
        name: profile.name,
        description: profile.description ?? null,
        handle: profile.handle ?? null,
      };
    }

    const profileApi = this.client.myProfile?.getMyProfile ?? this.client.humanApiProfile?.getMyProfile;
    if (!profileApi) {
      throw new UnsupportedFeatureError(
        "Fern client missing agentApiIdentity.getAgentMe or humanApiProfile.getMyProfile",
      );
    }

    const profile = await profileApi(mergeOptions(options));
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
    const api = this.client.chatMessages?.createChatMessage
      ?? this.client.agentApiMessages?.createAgentChatMessage
      ?? this.client.myChatMessages?.createMyChatMessage;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing chat message creation endpoint");
    }

    const response = await api(
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
    );
    return normalizeToolOperationResult(response);
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
    if (this.client.agentApiEvents?.createAgentChatEvent) {
      const response = await this.client.agentApiEvents.createAgentChatEvent(
        chatId,
        {
          event: {
            content: event.content,
            message_type: event.messageType,
            metadata: event.metadata,
          },
        },
        mergeOptions(options),
      );
      return normalizeToolOperationResult(response);
    }

    return this.createChatMessage(chatId, event, options);
  }

  public async createChat(taskId?: string, options?: RestRequestOptions): Promise<{ id: string }> {
    const api = this.client.chatRooms?.createChat ?? this.client.agentApiChats?.createAgentChat;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing chat creation endpoint");
    }

    const response = await api(
      {
        chat: {
          task_id: taskId,
        },
      },
      mergeOptions(options),
    );

    const roomId = extractChatId(response);
    if (!roomId) {
      throw new UnsupportedFeatureError("Chat create response did not include id");
    }

    return { id: roomId };
  }

  public async listChatParticipants(
    chatId: string,
    options?: RestRequestOptions,
  ): Promise<ChatParticipant[]> {
    const requestOptions = mergeOptions(options);
    const listChatParticipantsApi = this.client.chatParticipants?.listChatParticipants;
    if (listChatParticipantsApi) {
      return normalizeChatParticipantsResponse(
        await listChatParticipantsApi(chatId, {}, requestOptions),
      );
    }

    const listAgentChatParticipantsApi = this.client.agentApiParticipants?.listAgentChatParticipants;
    if (!listAgentChatParticipantsApi) {
      throw new UnsupportedFeatureError("Fern client missing chat participant list endpoint");
    }

    return normalizeChatParticipantsResponse(
      await listAgentChatParticipantsApi(chatId, requestOptions),
    );
  }

  public async addChatParticipant(
    chatId: string,
    participant: { participantId: string; role: string },
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    const api = this.client.chatParticipants?.addChatParticipant
      ?? this.client.agentApiParticipants?.addAgentChatParticipant;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing chat participant add endpoint");
    }

    const response = await api(
      chatId,
      {
        participant: {
          participant_id: participant.participantId,
          role: participant.role,
        },
      },
      mergeOptions(options),
    );
    return normalizeToolOperationResult(response);
  }

  public async removeChatParticipant(
    chatId: string,
    participantId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    const api = this.client.chatParticipants?.removeChatParticipant
      ?? this.client.agentApiParticipants?.removeAgentChatParticipant;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing chat participant remove endpoint");
    }

    const response = await api(chatId, participantId, mergeOptions(options));
    return normalizeToolOperationResult(response);
  }

  public async markMessageProcessing(
    chatId: string,
    messageId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    const api = this.client.chatMessages?.markMessageProcessing
      ?? this.client.agentApiMessages?.markAgentMessageProcessing;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing mark message processing endpoint");
    }

    const response = await api(chatId, messageId, mergeOptions(options));
    return normalizeToolOperationResult(response);
  }

  public async markMessageProcessed(
    chatId: string,
    messageId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    const api = this.client.chatMessages?.markMessageProcessed
      ?? this.client.agentApiMessages?.markAgentMessageProcessed;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing mark message processed endpoint");
    }

    const response = await api(chatId, messageId, mergeOptions(options));
    return normalizeToolOperationResult(response);
  }

  public async markMessageFailed(
    chatId: string,
    messageId: string,
    error: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    const api = this.client.chatMessages?.markMessageFailed
      ?? this.client.agentApiMessages?.markAgentMessageFailed;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing mark message failed endpoint");
    }

    const response = await api(
      chatId,
      messageId,
      { error },
      mergeOptions(options),
    );
    return normalizeToolOperationResult(response);
  }

  public async getNextMessage(
    request: { chatId: string },
    options?: RestRequestOptions,
  ): Promise<PlatformChatMessage | null> {
    const api = this.client.chatMessages?.getNextMessage
      ?? this.client.agentApiMessages?.getAgentNextMessage;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing next-message endpoint");
    }

    const response = await api(request.chatId, mergeOptions(options));
    return normalizePlatformChatMessage(extractEnvelopeData(response));
  }

  public async listPeers(
    request: { page: number; pageSize: number; notInChat: string },
    options?: RestRequestOptions,
  ): Promise<{ data: PeerRecord[]; metadata?: MetadataMap }> {
    const api = this.client.agentPeers?.listAgentPeers ?? this.client.agentApiPeers?.listAgentPeers;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing peer list endpoint");
    }

    const response = await api(
      {
        page: request.page,
        page_size: request.pageSize,
        not_in_chat: request.notInChat,
      },
      mergeOptions(options),
    );
    return normalizePaginatedResponse<PeerRecord>(response);
  }

  public async listChats(
    request: { page: number; pageSize: number },
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<MetadataMap>> {
    const api = this.client.chatRooms?.listChats ?? this.client.agentApiChats?.listAgentChats;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing chat list endpoint");
    }

    const response = await api(
      {
        page: request.page,
        page_size: request.pageSize,
      },
      mergeOptions(options),
    );

    return normalizePaginatedResponse<MetadataMap>(response);
  }

  public async listContacts(
    request: ListContactsArgs,
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<ContactRecord>> {
    const api = this.client.agentContacts?.listAgentContacts ?? this.client.agentApiContacts?.listAgentContacts;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing contact list endpoint");
    }

    const page = request.page ?? 1;
    const pageSize = request.pageSize ?? 50;

    const response = await api(
      {
        page,
        page_size: pageSize,
      },
      mergeOptions(options),
    );

    return normalizePaginatedResponse<ContactRecord>(response);
  }

  public async addContact(
    request: AddContactArgs,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    const api = this.client.agentContacts?.addAgentContact ?? this.client.agentApiContacts?.addAgentContact;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing add contact endpoint");
    }

    return normalizeToolOperationResult(
      await api(
        { handle: request.handle, ...(request.message ? { message: request.message } : {}) },
        mergeOptions(options),
      ),
    );
  }

  public async removeContact(
    request: RemoveContactArgs,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    const api = this.client.agentContacts?.removeAgentContact ?? this.client.agentApiContacts?.removeAgentContact;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing remove contact endpoint");
    }

    return normalizeToolOperationResult(
      await api(
        request.target === "handle"
          ? { handle: request.handle }
          : { contact_id: request.contactId },
        mergeOptions(options),
      ),
    );
  }

  public async listContactRequests(
    request: ListContactRequestsArgs,
    options?: RestRequestOptions,
  ): Promise<ContactRequestsResult> {
    const api = this.client.agentContacts?.listAgentContactRequests
      ?? this.client.agentApiContacts?.listAgentContactRequests;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing contact request list endpoint");
    }

    const page = request.page ?? 1;
    const pageSize = request.pageSize ?? 50;
    const sentStatus = request.sentStatus ?? "pending";

    const response = await api(
      {
        page,
        page_size: pageSize,
        sent_status: sentStatus,
      },
      mergeOptions(options),
    );

    return normalizeContactRequestsResponse(response);
  }

  public async respondContactRequest(
    request: RespondContactRequestArgs,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    const api = this.client.agentContacts?.respondToAgentContactRequest
      ?? this.client.agentApiContacts?.respondToAgentContactRequest;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing contact request response endpoint");
    }

    return normalizeToolOperationResult(
      await api(
        request.target === "handle"
          ? { action: request.action, handle: request.handle }
          : { action: request.action, request_id: request.requestId },
        mergeOptions(options),
      ),
    );
  }

  public async listMemories(
    request: ListMemoriesArgs,
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<MemoryRecord>> {
    const api = this.client.agentMemories?.listAgentMemories ?? this.client.agentApiMemories?.listAgentMemories;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing memory list endpoint");
    }

    const response = await api(request, mergeOptions(options));
    return normalizePaginatedResponse<MemoryRecord>(response);
  }

  public async storeMemory(
    request: StoreMemoryArgs,
    options?: RestRequestOptions,
  ): Promise<MemoryRecord> {
    const api = this.client.agentMemories?.createAgentMemory ?? this.client.agentApiMemories?.createAgentMemory;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing create memory endpoint");
    }

    return normalizeMemoryRecord(
      await api(
        { memory: request },
        mergeOptions(options),
      ),
    );
  }

  public async getMemory(
    memoryId: string,
    options?: RestRequestOptions,
  ): Promise<MemoryRecord> {
    const api = this.client.agentMemories?.getAgentMemory ?? this.client.agentApiMemories?.getAgentMemory;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing get memory endpoint");
    }

    return normalizeMemoryRecord(
      await api(memoryId, mergeOptions(options)),
    );
  }

  public async supersedeMemory(
    memoryId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    const api = this.client.agentMemories?.supersedeAgentMemory
      ?? this.client.agentApiMemories?.supersedeAgentMemory;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing supersede memory endpoint");
    }

    return normalizeToolOperationResult(
      await api(memoryId, mergeOptions(options)),
    );
  }

  public async archiveMemory(
    memoryId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    const api = this.client.agentMemories?.archiveAgentMemory
      ?? this.client.agentApiMemories?.archiveAgentMemory;
    if (!api) {
      throw new UnsupportedFeatureError("Fern client missing archive memory endpoint");
    }

    return normalizeToolOperationResult(
      await api(memoryId, mergeOptions(options)),
    );
  }

  public async listMessages(
    request: { chatId: string; page: number; pageSize: number; status?: string },
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<PlatformChatMessage>> {
    const requestOptions = mergeOptions(options);
    const listRequest = {
      page: request.page,
      page_size: request.pageSize,
      status: request.status,
    };

    const listMessagesApi = this.client.chatMessages?.listMessages;
    if (listMessagesApi) {
      return normalizePaginatedResponse<PlatformChatMessage>(
        await listMessagesApi(request.chatId, listRequest, requestOptions),
      );
    }

    const listAgentMessagesApi = this.client.agentApiMessages?.listAgentMessages;
    if (!listAgentMessagesApi) {
      throw new UnsupportedFeatureError("Fern client missing message list endpoint");
    }

    return normalizePaginatedResponse<PlatformChatMessage>(
      await listAgentMessagesApi(request.chatId, listRequest, requestOptions),
    );
  }

  public async getChatContext(
    request: { chatId: string; page?: number; pageSize?: number },
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<PlatformChatMessage>> {
    const requestOptions = mergeOptions(options);
    const contextRequest = {
      page: request.page,
      page_size: request.pageSize,
    };

    const getChatContextApi = this.client.chatContext?.getChatContext;
    if (getChatContextApi) {
      return normalizePaginatedResponse<PlatformChatMessage>(
        await getChatContextApi(request.chatId, contextRequest, requestOptions),
      );
    }

    const getAgentChatContextApi = this.client.agentApiContext?.getAgentChatContext;
    if (!getAgentChatContextApi) {
      throw new UnsupportedFeatureError("Fern client missing chat context endpoint");
    }

    return normalizePaginatedResponse<PlatformChatMessage>(
      await getAgentChatContextApi(request.chatId, contextRequest, requestOptions),
    );
  }
}

interface RestFacadeOptions {
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

  public getChatContext(
    request: { chatId: string; page?: number; pageSize?: number },
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<PlatformChatMessage>> {
    return this.forward("getChatContext", async () => {
      if (!this.api.getChatContext) {
        throw new UnsupportedFeatureError("Context hydration is not available in current REST adapter");
      }

      return this.api.getChatContext(request, options);
    }, request);
  }

  public listMessages(
    request: { chatId: string; page: number; pageSize: number; status?: string },
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<PlatformChatMessage>> {
    return this.forward("listMessages", async () => {
      if (!this.api.listMessages) {
        throw new UnsupportedFeatureError("Message queue listing is not available in current REST adapter");
      }

      return this.api.listMessages(request, options);
    }, request);
  }

  public getNextMessage(
    request: { chatId: string },
    options?: RestRequestOptions,
  ): Promise<PlatformChatMessage | null> {
    return this.forward("getNextMessage", async () => {
      if (!this.api.getNextMessage) {
        throw new UnsupportedFeatureError("Message queue next-item lookup is not available in current REST adapter");
      }

      return this.api.getNextMessage(request, options);
    }, request);
  }

  public listContacts(
    request: ListContactsArgs,
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<ContactRecord>> {
    return this.forward("listContacts", async () => {
      if (!this.api.listContacts) {
        throw new UnsupportedFeatureError("Contact listing is not available in current REST adapter");
      }

      const response = await this.api.listContacts(request, options);
      return {
        data: response.data ?? [],
        metadata: normalizePaginationMetadata(response.metadata),
      };
    }, request);
  }

  public addContact(
    request: AddContactArgs,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    return this.forward("addContact", async () => {
      if (!this.api.addContact) {
        throw new UnsupportedFeatureError("Contact creation is not available in current REST adapter");
      }

      return this.api.addContact(request, options);
    }, request);
  }

  public removeContact(
    request: RemoveContactArgs,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    return this.forward("removeContact", async () => {
      if (!this.api.removeContact) {
        throw new UnsupportedFeatureError("Contact removal is not available in current REST adapter");
      }

      return this.api.removeContact(request, options);
    }, request);
  }

  public listContactRequests(
    request: ListContactRequestsArgs,
    options?: RestRequestOptions,
  ): Promise<ContactRequestsResult> {
    return this.forward("listContactRequests", async () => {
      if (!this.api.listContactRequests) {
        throw new UnsupportedFeatureError("Contact request listing is not available in current REST adapter");
      }

      const response = await this.api.listContactRequests(request, options);
      return normalizeContactRequestsResult(response);
    }, request);
  }

  public respondContactRequest(
    request: RespondContactRequestArgs,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    return this.forward("respondContactRequest", async () => {
      if (!this.api.respondContactRequest) {
        throw new UnsupportedFeatureError("Contact request responses are not available in current REST adapter");
      }

      return this.api.respondContactRequest(request, options);
    }, request);
  }

  public listMemories(
    request: ListMemoriesArgs,
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<MemoryRecord>> {
    return this.forward("listMemories", async () => {
      if (!this.api.listMemories) {
        throw new UnsupportedFeatureError("Memory listing is not available in current REST adapter");
      }

      const response = await this.api.listMemories(request, options);
      return {
        data: response.data ?? [],
        metadata: normalizePaginationMetadata(response.metadata),
      };
    }, request);
  }

  public storeMemory(
    request: StoreMemoryArgs,
    options?: RestRequestOptions,
  ): Promise<MemoryRecord> {
    return this.forward("storeMemory", async () => {
      if (!this.api.storeMemory) {
        throw new UnsupportedFeatureError("Memory creation is not available in current REST adapter");
      }

      return this.api.storeMemory(request, options);
    }, request);
  }

  public getMemory(
    memoryId: string,
    options?: RestRequestOptions,
  ): Promise<MemoryRecord> {
    return this.forward("getMemory", async () => {
      if (!this.api.getMemory) {
        throw new UnsupportedFeatureError("Memory lookup is not available in current REST adapter");
      }

      return this.api.getMemory(memoryId, options);
    }, { memoryId });
  }

  public supersedeMemory(
    memoryId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    return this.forward("supersedeMemory", async () => {
      if (!this.api.supersedeMemory) {
        throw new UnsupportedFeatureError("Memory supersede is not available in current REST adapter");
      }

      return this.api.supersedeMemory(memoryId, options);
    }, { memoryId });
  }

  public archiveMemory(
    memoryId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    return this.forward("archiveMemory", async () => {
      if (!this.api.archiveMemory) {
        throw new UnsupportedFeatureError("Memory archive is not available in current REST adapter");
      }

      return this.api.archiveMemory(memoryId, options);
    }, { memoryId });
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
    metadata?: object,
  ): Promise<T> {
    this.logger.debug(`REST ${operation}`, metadata as Record<string, unknown>);
    return call();
  }
}
