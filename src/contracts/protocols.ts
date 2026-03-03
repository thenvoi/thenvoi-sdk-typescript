import type {
  ContactRecord,
  ContactRequestRecord,
  MemoryRecord,
  MentionInput,
  MetadataMap,
  PaginatedList,
  ParticipantRecord,
  PeerRecord,
  ToolOperationResult,
  ToolSchemaRecord,
} from "./dtos";

export interface HistoryConverter<T> {
  convert(raw: MetadataMap[]): T;
}

export interface PlatformMessageLike {
  id: string;
  roomId: string;
  content: string;
  senderId: string;
  senderType: string;
  senderName: string | null;
  messageType: string;
  metadata: MetadataMap;
  createdAt: Date;
}

export interface HistoryLike {
  readonly raw: MetadataMap[];
  convert<T>(converter: HistoryConverter<T>): T;
  readonly length: number;
}

export interface MessagingTools {
  sendMessage(
    content: string,
    mentions?: MentionInput,
  ): Promise<ToolOperationResult>;
  sendEvent(
    content: string,
    messageType: string,
    metadata?: MetadataMap,
  ): Promise<ToolOperationResult>;
}

export interface RoomParticipantTools {
  addParticipant(name: string, role?: string): Promise<ToolOperationResult>;
  removeParticipant(name: string): Promise<ToolOperationResult>;
  getParticipants(): Promise<ParticipantRecord[]>;
  createChatroom(taskId?: string): Promise<string>;
}

export interface PeerLookupTools {
  lookupPeers(page?: number, pageSize?: number): Promise<PaginatedList<PeerRecord>>;
}

export interface ToolSchemaProvider {
  getToolSchemas(
    format: "openai" | "anthropic",
    options?: { includeMemory?: boolean },
  ): ToolSchemaRecord[];
  getAnthropicToolSchemas(options?: { includeMemory?: boolean }): ToolSchemaRecord[];
  getOpenAIToolSchemas(options?: { includeMemory?: boolean }): ToolSchemaRecord[];
}

export interface ContactTools {
  listContacts(page?: number, pageSize?: number): Promise<PaginatedList<ContactRecord>>;
  addContact(handle: string, message?: string): Promise<ToolOperationResult>;
  removeContact(handle?: string, contactId?: string): Promise<ToolOperationResult>;
  listContactRequests(
    page?: number,
    pageSize?: number,
    sentStatus?: string,
  ): Promise<PaginatedList<ContactRequestRecord>>;
  respondContactRequest(
    action: string,
    handle?: string,
    requestId?: string,
  ): Promise<ToolOperationResult>;
}

export interface MemoryTools {
  listMemories(args?: MetadataMap): Promise<PaginatedList<MemoryRecord>>;
  storeMemory(args: MetadataMap): Promise<ToolOperationResult>;
  getMemory(memoryId: string): Promise<ToolOperationResult>;
  supersedeMemory(memoryId: string): Promise<ToolOperationResult>;
  archiveMemory(memoryId: string): Promise<ToolOperationResult>;
}

export interface ToolExecutor {
  executeToolCall(toolName: string, arguments_: MetadataMap): Promise<unknown>;
}

export interface ParticipantTools extends RoomParticipantTools, PeerLookupTools {}

export interface AdapterToolsProtocol
  extends
    MessagingTools,
    RoomParticipantTools,
    ToolSchemaProvider,
    ToolExecutor,
    Partial<PeerLookupTools>,
    Partial<ContactTools>,
    Partial<MemoryTools> {}

export type AgentToolsProtocol = AdapterToolsProtocol;

export interface AgentToolsCapabilities {
  peers: boolean;
  contacts: boolean;
  memory: boolean;
}

export const DEFAULT_AGENT_TOOLS_CAPABILITIES: AgentToolsCapabilities = {
  peers: false,
  contacts: false,
  memory: false,
};

export interface FrameworkAdapterInput {
  message: PlatformMessageLike;
  tools: AdapterToolsProtocol;
  history: HistoryLike;
  participantsMessage: string | null;
  contactsMessage: string | null;
  isSessionBootstrap: boolean;
  roomId: string;
}

export interface PreprocessorContext {
  roomId: string;
  recordMessage(message: PlatformMessageLike): void;
  getTools(): AdapterToolsProtocol;
  getRawHistory(): MetadataMap[];
  consumeParticipantsMessage(): string | null;
  consumeContactsMessage(): string | null;
  consumeBootstrap(): boolean;
}

export interface FrameworkAdapter {
  onEvent(input: FrameworkAdapterInput): Promise<void>;
  onCleanup(roomId: string): Promise<void>;
  onStarted(agentName: string, agentDescription: string): Promise<void>;
  onRuntimeStop?(): Promise<void>;
}

export interface EventEnvelope {
  type: string;
  roomId: string | null;
  payload: MetadataMap;
  raw?: MetadataMap;
}

export interface Preprocessor<TEvent extends EventEnvelope = EventEnvelope> {
  process(
    context: PreprocessorContext,
    event: TEvent,
    agentId: string,
  ): Promise<FrameworkAdapterInput | null>;
}
