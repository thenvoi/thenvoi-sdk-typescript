import type { RestRequestOptions } from "./requestOptions";
import type {
  ContactRecord,
  ContactRequestAction,
  ContactRequestsResult,
  ListMemoriesArgs,
  MemoryRecord,
  MentionReference,
  MetadataMap,
  PaginatedList,
  PaginationMetadataLike,
  PeerRecord,
  StoreMemoryArgs,
  ToolOperationResult,
} from "../../contracts/dtos";

export interface AgentIdentity {
  id: string;
  name: string;
  description: string | null;
}

export interface ChatParticipant extends MetadataMap {
  id: string;
  name: string;
  type: string;
  handle?: string | null;
}

export interface ChatMessageMention {
  id: string;
  handle?: string;
  username?: string;
}

export interface PaginationMetadata extends PaginationMetadataLike {}

export interface PaginatedResponse<T extends MetadataMap = MetadataMap> extends PaginatedList<T> {}

export interface PlatformChatMessage extends MetadataMap {
  id: string;
  content: string;
  sender_id: string;
  sender_type: string;
  sender_name?: string | null;
  message_type: string;
  metadata?: MetadataMap | null;
  inserted_at: string;
  updated_at?: string | null;
}

export interface AgentProfileRestApi {
  getAgentMe(options?: RestRequestOptions): Promise<AgentIdentity>;
}

export interface ChatMessagingRestApi {
  createChatMessage(
    chatId: string,
    message: {
      content: string;
      messageType?: string;
      metadata?: MetadataMap;
      mentions?: MentionReference[];
    },
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult>;
  createChatEvent(
    chatId: string,
    event: {
      content: string;
      messageType: string;
      metadata?: MetadataMap;
    },
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult>;
}

export interface ChatRoomRestApi {
  createChat(taskId?: string, options?: RestRequestOptions): Promise<{ id: string }>;
}

export interface ParticipantRestApi {
  listChatParticipants(
    chatId: string,
    options?: RestRequestOptions,
  ): Promise<ChatParticipant[]>;
  addChatParticipant(
    chatId: string,
    participant: { participantId: string; role: string },
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult>;
  removeChatParticipant(
    chatId: string,
    participantId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult>;
}

export interface MessageLifecycleRestApi {
  markMessageProcessing(
    chatId: string,
    messageId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult>;
  markMessageProcessed(
    chatId: string,
    messageId: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult>;
  markMessageFailed(
    chatId: string,
    messageId: string,
    error: string,
    options?: RestRequestOptions,
  ): Promise<ToolOperationResult>;
}

export interface PeerLookupRestApi {
  listPeers?(
    _request: { page: number; pageSize: number; notInChat: string },
    _options?: RestRequestOptions,
  ): Promise<PaginatedResponse<PeerRecord>>;
}

export interface ChatListingRestApi {
  listChats?(
    _request: { page: number; pageSize: number },
    _options?: RestRequestOptions,
  ): Promise<PaginatedResponse>;
}

export interface ContactRestApi {
  listContacts?(
    _request: { page: number; pageSize: number },
    _options?: RestRequestOptions,
  ): Promise<PaginatedResponse<ContactRecord>>;
  addContact?(
    _handle: string,
    _message?: string,
    _options?: RestRequestOptions,
  ): Promise<ToolOperationResult>;
  removeContact?(
    _request: { handle?: string; contactId?: string },
    _options?: RestRequestOptions,
  ): Promise<ToolOperationResult>;
  listContactRequests?(
    _request: { page: number; pageSize: number; sentStatus: string },
    _options?: RestRequestOptions,
  ): Promise<ContactRequestsResult>;
  respondContactRequest?(
    _request: { action: ContactRequestAction; handle?: string; requestId?: string },
    _options?: RestRequestOptions,
  ): Promise<ToolOperationResult>;
}

export interface MemoryRestApi {
  listMemories?(
    _request: ListMemoriesArgs,
    _options?: RestRequestOptions,
  ): Promise<PaginatedResponse<MemoryRecord>>;
  storeMemory?(
    _request: StoreMemoryArgs,
    _options?: RestRequestOptions,
  ): Promise<MemoryRecord>;
  getMemory?(
    _memoryId: string,
    _options?: RestRequestOptions,
  ): Promise<MemoryRecord>;
  supersedeMemory?(
    _memoryId: string,
    _options?: RestRequestOptions,
  ): Promise<ToolOperationResult>;
  archiveMemory?(
    _memoryId: string,
    _options?: RestRequestOptions,
  ): Promise<ToolOperationResult>;
}

export interface ContextRestApi {
  getChatContext?(
    _request: { chatId: string; page?: number; pageSize?: number },
    _options?: RestRequestOptions,
  ): Promise<PaginatedResponse<PlatformChatMessage>>;
}

export interface MessageQueueRestApi {
  listMessages?(
    _request: { chatId: string; page: number; pageSize: number; status?: string },
    _options?: RestRequestOptions,
  ): Promise<PaginatedResponse<PlatformChatMessage>>;
  getNextMessage?(
    _request: { chatId: string },
    _options?: RestRequestOptions,
  ): Promise<PlatformChatMessage | null>;
}

export type AgentToolsRestApi =
  & ChatMessagingRestApi
  & ChatRoomRestApi
  & ParticipantRestApi
  & PeerLookupRestApi
  & ContactRestApi
  & MemoryRestApi
  & ContextRestApi
  & MessageQueueRestApi;

export type ThenvoiLinkRestApi =
  & AgentProfileRestApi
  & MessageLifecycleRestApi
  & AgentToolsRestApi
  & ChatListingRestApi;

export interface RestApi extends ThenvoiLinkRestApi {}

export interface FernUserProfile {
  id: string;
  name?: string;
  description?: string | null;
  first_name?: string;
  last_name?: string;
  username?: string;
}

// Method syntax (not property-function syntax) is used intentionally so that
// TypeScript checks parameter types bivariantly.
export interface FernThenvoiClientLike {
  myProfile?: {
    getMyProfile(options?: RestRequestOptions): Promise<FernUserProfile>;
  };
  agentPeers?: {
    listAgentPeers?(
      request?: { page?: number; page_size?: number; not_in_chat?: string },
      options?: RestRequestOptions,
    ): Promise<unknown>;
  };
  agentContacts?: {
    listAgentContacts?(
      request?: { page?: number; page_size?: number },
      options?: RestRequestOptions,
    ): Promise<unknown>;
    addAgentContact?(
      request: { handle: string; message?: string },
      options?: RestRequestOptions,
    ): Promise<unknown>;
    removeAgentContact?(
      request: { handle?: string; contact_id?: string },
      options?: RestRequestOptions,
    ): Promise<unknown>;
    listAgentContactRequests?(
      request?: { page?: number; page_size?: number; sent_status?: string },
      options?: RestRequestOptions,
    ): Promise<unknown>;
    respondToAgentContactRequest?(
      request: { action: ContactRequestAction; handle?: string; request_id?: string },
      options?: RestRequestOptions,
    ): Promise<unknown>;
  };
  agentMemories?: {
    listAgentMemories?(
      request?: ListMemoriesArgs,
      options?: RestRequestOptions,
    ): Promise<unknown>;
    createAgentMemory?(
      request: { memory: StoreMemoryArgs },
      options?: RestRequestOptions,
    ): Promise<unknown>;
    getAgentMemory?(
      memoryId: string,
      options?: RestRequestOptions,
    ): Promise<unknown>;
    supersedeAgentMemory?(
      memoryId: string,
      options?: RestRequestOptions,
    ): Promise<unknown>;
    archiveAgentMemory?(
      memoryId: string,
      options?: RestRequestOptions,
    ): Promise<unknown>;
  };
  chatMessages?: {
    createChatMessage(
      chatId: string,
      request: {
        message: {
          content: string;
          message_type?: string;
          metadata?: MetadataMap;
          mentions?: MentionReference[];
        };
      },
      options?: RestRequestOptions,
    ): Promise<unknown>;
    markMessageProcessing?(
      chatId: string,
      id: string,
      options?: RestRequestOptions,
    ): Promise<unknown>;
    markMessageProcessed?(
      chatId: string,
      id: string,
      options?: RestRequestOptions,
    ): Promise<unknown>;
    markMessageFailed?(
      chatId: string,
      id: string,
      request: { error: string },
      options?: RestRequestOptions,
    ): Promise<unknown>;
    getNextMessage?(
      chatId: string,
      options?: RestRequestOptions,
    ): Promise<unknown>;
  };
  myChatMessages?: {
    createMyChatMessage(
      chatId: string,
      request: {
        message: {
          content: string;
          message_type?: string;
          metadata?: MetadataMap;
          mentions?: MentionReference[];
        };
      },
      options?: RestRequestOptions,
    ): Promise<unknown>;
  };
  chatRooms?: {
    createChat(
      request: { chat: { task_id?: string } },
      options?: RestRequestOptions,
    ): Promise<unknown>;
    listChats?(
      request?: { page?: number; page_size?: number },
      options?: RestRequestOptions,
    ): Promise<unknown>;
  };
  chatParticipants?: {
    listChatParticipants(
      chatId: string,
      request?: { participant_type?: "User" | "Agent" },
      options?: RestRequestOptions,
    ): Promise<unknown>;
    addChatParticipant(
      chatId: string,
      request: { participant: { participant_id: string; role: string } },
      options?: RestRequestOptions,
    ): Promise<unknown>;
    removeChatParticipant(
      chatId: string,
      participantId: string,
      options?: RestRequestOptions,
    ): Promise<unknown>;
  };
}
