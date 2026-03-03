import type { RestRequestOptions } from "./requestOptions";
import type {
  MentionReference,
  MetadataMap,
  PaginatedList,
  PaginationMetadataLike,
  PeerRecord,
  ToolOperationResult,
} from "../../contracts/dtos";

export interface AgentIdentity {
  id: string;
  name: string;
  description: string | null;
}

export interface ChatParticipant {
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

export type AgentToolsRestApi =
  & ChatMessagingRestApi
  & ChatRoomRestApi
  & ParticipantRestApi
  & PeerLookupRestApi;

export type ThenvoiLinkRestApi =
  & AgentProfileRestApi
  & MessageLifecycleRestApi
  & AgentToolsRestApi
  & ChatListingRestApi;

export interface RestApi extends ThenvoiLinkRestApi {}

export interface FernThenvoiClientLike {
  myProfile?: {
    getMyProfile: (options?: RestRequestOptions) => Promise<{ id: string; name: string; description?: string | null }>;
  };
  chatMessages?: {
    createChatMessage: (
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
    ) => Promise<ToolOperationResult>;
    markMessageProcessing?: (
      chatId: string,
      id: string,
      options?: RestRequestOptions,
    ) => Promise<ToolOperationResult>;
    markMessageProcessed?: (
      chatId: string,
      id: string,
      options?: RestRequestOptions,
    ) => Promise<ToolOperationResult>;
    markMessageFailed?: (
      chatId: string,
      id: string,
      request: { error: string },
      options?: RestRequestOptions,
    ) => Promise<ToolOperationResult>;
  };
  myChatMessages?: {
    createMyChatMessage: (
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
    ) => Promise<ToolOperationResult>;
  };
  chatRooms?: {
    createChat: (
      request: { chat: { task_id?: string } },
      options?: RestRequestOptions,
    ) => Promise<{ id: string } | { data?: { id?: string } }>;
    listChats?: (
      request?: { page?: number; page_size?: number },
      options?: RestRequestOptions,
    ) => Promise<
      | MetadataMap[]
      | { data?: MetadataMap[]; metadata?: PaginationMetadata }
      | { data?: { data?: MetadataMap[]; metadata?: PaginationMetadata } }
    >;
  };
  chatParticipants?: {
    listChatParticipants: (
      chatId: string,
      request?: { participant_type?: "User" | "Agent" },
      options?: RestRequestOptions,
    ) => Promise<ChatParticipant[] | { data?: ChatParticipant[] }>;
    addChatParticipant: (
      chatId: string,
      request: { participant: { participant_id: string; role: string } },
      options?: RestRequestOptions,
    ) => Promise<ToolOperationResult>;
    removeChatParticipant: (
      chatId: string,
      participantId: string,
      options?: RestRequestOptions,
    ) => Promise<ToolOperationResult>;
  };
}
