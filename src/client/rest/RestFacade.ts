import { UnsupportedFeatureError } from "../../core/errors";
import type { Logger } from "../../core/logger";
import { NoopLogger } from "../../core/logger";
import type {
  ContactRecord,
  ContactRequestAction,
  ContactRequestsResult,
  ListMemoriesArgs,
  MemoryRecord,
  MentionReference,
  MetadataMap,
  PeerRecord,
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
  const record = asRecord(value);
  if (record?.data !== undefined) {
    return record.data as T;
  }

  return value as T;
}

function isMetadataMap(value: unknown): value is MetadataMap {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): MetadataMap | undefined {
  return isMetadataMap(value) ? value : undefined;
}

function asRecordArray<T extends MetadataMap = MetadataMap>(value: unknown): T[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((entry): entry is T => isMetadataMap(entry));
}

function extractEnvelopeData(value: unknown): unknown {
  const record = asRecord(value);
  if (!record || record.data === undefined) {
    return value;
  }

  return record.data;
}

function extractEnvelopeMetadata(value: unknown): MetadataMap | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  return asRecord(record.metadata) ?? asRecord(record.meta);
}

function normalizePaginatedResponse<T extends MetadataMap = MetadataMap>(
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
  const direction = asRecord(value);
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
  const metadata = asRecord(result.metadata);
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
  const payload = asRecord(extractEnvelopeData(response));
  return normalizeContactRequestsResult({
    received: asRecordArray(payload?.received) ?? [],
    sent: asRecordArray(payload?.sent) ?? [],
    metadata: extractEnvelopeMetadata(response) ?? extractEnvelopeMetadata(payload),
  });
}

function normalizeToolOperationResult(response: unknown): ToolOperationResult {
  return asRecord(extractEnvelopeData(response)) ?? {};
}

function normalizeMemoryRecord(response: unknown): MemoryRecord {
  return asRecord(extractEnvelopeData(response)) ?? {};
}

function extractChatId(response: unknown): string | undefined {
  const payload = asRecord(extractEnvelopeData(response));
  return typeof payload?.id === "string" ? payload.id : undefined;
}

function isChatParticipant(value: unknown): value is ChatParticipant {
  const record = asRecord(value);
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
    if (!this.client.chatParticipants?.listChatParticipants) {
      throw new UnsupportedFeatureError("Fern client missing chatParticipants.listChatParticipants");
    }

    const response = await this.client.chatParticipants.listChatParticipants(
      chatId,
      {},
      mergeOptions(options),
    );
    return normalizeChatParticipantsResponse(response);
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

  public async getNextMessage(
    request: { chatId: string },
    options?: RestRequestOptions,
  ): Promise<PlatformChatMessage | null> {
    if (!this.client.chatMessages?.getNextMessage) {
      throw new UnsupportedFeatureError("Fern client missing chatMessages.getNextMessage");
    }

    const response = await this.client.chatMessages.getNextMessage(
      request.chatId,
      mergeOptions(options),
    );
    const payload = asRecord(extractEnvelopeData(response));
    if (!payload) {
      return null;
    }

    return payload as PlatformChatMessage;
  }

  public async listPeers(
    request: { page: number; pageSize: number; notInChat: string },
    options?: RestRequestOptions,
  ): Promise<{ data: PeerRecord[]; metadata?: MetadataMap }> {
    if (!this.client.agentPeers?.listAgentPeers) {
      throw new UnsupportedFeatureError(
        "Fern client missing agentPeers.listAgentPeers",
      );
    }

    const response = await this.client.agentPeers.listAgentPeers(
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

    return normalizePaginatedResponse<MetadataMap>(response);
  }

  public async listContacts(
    request: { page: number; pageSize: number },
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<ContactRecord>> {
    if (!this.client.agentContacts?.listAgentContacts) {
      throw new UnsupportedFeatureError("Fern client missing agentContacts.listAgentContacts");
    }

    const response = await this.client.agentContacts.listAgentContacts(
      {
        page: request.page,
        page_size: request.pageSize,
      },
      mergeOptions(options),
    );

    return normalizePaginatedResponse<ContactRecord>(response);
  }

  public async addContact(
    handle: string,
    message?: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    if (!this.client.agentContacts?.addAgentContact) {
      throw new UnsupportedFeatureError("Fern client missing agentContacts.addAgentContact");
    }

    return normalizeToolOperationResult(
      await this.client.agentContacts.addAgentContact(
        { handle, ...(message ? { message } : {}) },
        mergeOptions(options),
      ),
    );
  }

  public async removeContact(
    request: { handle?: string; contactId?: string },
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    if (!this.client.agentContacts?.removeAgentContact) {
      throw new UnsupportedFeatureError("Fern client missing agentContacts.removeAgentContact");
    }

    return normalizeToolOperationResult(
      await this.client.agentContacts.removeAgentContact(
        {
          ...(request.handle ? { handle: request.handle } : {}),
          ...(request.contactId ? { contact_id: request.contactId } : {}),
        },
        mergeOptions(options),
      ),
    );
  }

  public async listContactRequests(
    request: { page: number; pageSize: number; sentStatus: string },
    options?: RestRequestOptions,
  ): Promise<ContactRequestsResult> {
    if (!this.client.agentContacts?.listAgentContactRequests) {
      throw new UnsupportedFeatureError("Fern client missing agentContacts.listAgentContactRequests");
    }

    const response = await this.client.agentContacts.listAgentContactRequests(
      {
        page: request.page,
        page_size: request.pageSize,
        sent_status: request.sentStatus,
      },
      mergeOptions(options),
    );

    return normalizeContactRequestsResponse(response);
  }

  public async respondContactRequest(
    request: { action: ContactRequestAction; handle?: string; requestId?: string },
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    if (!this.client.agentContacts?.respondToAgentContactRequest) {
      throw new UnsupportedFeatureError("Fern client missing agentContacts.respondToAgentContactRequest");
    }

    return normalizeToolOperationResult(
      await this.client.agentContacts.respondToAgentContactRequest(
        {
          action: request.action,
          ...(request.handle ? { handle: request.handle } : {}),
          ...(request.requestId ? { request_id: request.requestId } : {}),
        },
        mergeOptions(options),
      ),
    );
  }

  public async listMemories(
    request: ListMemoriesArgs,
    options?: RestRequestOptions,
  ): Promise<PaginatedResponse<MemoryRecord>> {
    if (!this.client.agentMemories?.listAgentMemories) {
      throw new UnsupportedFeatureError("Fern client missing agentMemories.listAgentMemories");
    }

    const response = await this.client.agentMemories.listAgentMemories(request, mergeOptions(options));
    return normalizePaginatedResponse<MemoryRecord>(response);
  }

  public async storeMemory(
    request: StoreMemoryArgs,
    options?: RestRequestOptions,
  ): Promise<MemoryRecord> {
    if (!this.client.agentMemories?.createAgentMemory) {
      throw new UnsupportedFeatureError("Fern client missing agentMemories.createAgentMemory");
    }

    return normalizeMemoryRecord(
      await this.client.agentMemories.createAgentMemory(
        { memory: request },
        mergeOptions(options),
      ),
    );
  }

  public async getMemory(
    memoryId: string,
    options?: RestRequestOptions,
  ): Promise<MemoryRecord> {
    if (!this.client.agentMemories?.getAgentMemory) {
      throw new UnsupportedFeatureError("Fern client missing agentMemories.getAgentMemory");
    }

    return normalizeMemoryRecord(
      await this.client.agentMemories.getAgentMemory(memoryId, mergeOptions(options)),
    );
  }

  public async supersedeMemory(
    memoryId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    if (!this.client.agentMemories?.supersedeAgentMemory) {
      throw new UnsupportedFeatureError("Fern client missing agentMemories.supersedeAgentMemory");
    }

    return normalizeToolOperationResult(
      await this.client.agentMemories.supersedeAgentMemory(memoryId, mergeOptions(options)),
    );
  }

  public async archiveMemory(
    memoryId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    if (!this.client.agentMemories?.archiveAgentMemory) {
      throw new UnsupportedFeatureError("Fern client missing agentMemories.archiveAgentMemory");
    }

    return normalizeToolOperationResult(
      await this.client.agentMemories.archiveAgentMemory(memoryId, mergeOptions(options)),
    );
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
    request: { page: number; pageSize: number },
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
    handle: string,
    message?: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult> {
    return this.forward("addContact", async () => {
      if (!this.api.addContact) {
        throw new UnsupportedFeatureError("Contact creation is not available in current REST adapter");
      }

      return this.api.addContact(handle, message, options);
    }, { handle });
  }

  public removeContact(
    request: { handle?: string; contactId?: string },
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
    request: { page: number; pageSize: number; sentStatus: string },
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
    request: { action: ContactRequestAction; handle?: string; requestId?: string },
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
    metadata?: MetadataMap,
  ): Promise<T> {
    this.logger.debug(`REST ${operation}`, metadata);
    return call();
  }
}
