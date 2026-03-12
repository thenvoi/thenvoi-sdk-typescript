import type {
  AddContactArgs,
  ContactRequestsResult,
  ContactRecord,
  ListContactRequestsArgs,
  ListContactsArgs,
  ListMemoriesArgs,
  MemoryRecord,
  MentionInput,
  MetadataMap,
  PaginatedList,
  ParticipantRecord,
  PeerRecord,
  RemoveContactArgs,
  RespondContactRequestArgs,
  StoreMemoryArgs,
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
  listContacts(request?: ListContactsArgs): Promise<PaginatedList<ContactRecord>>;
  addContact(request: AddContactArgs): Promise<ToolOperationResult>;
  removeContact(request: RemoveContactArgs): Promise<ToolOperationResult>;
  listContactRequests(
    request?: ListContactRequestsArgs,
  ): Promise<ContactRequestsResult>;
  respondContactRequest(request: RespondContactRequestArgs): Promise<ToolOperationResult>;
}

export interface MemoryTools {
  listMemories(args?: ListMemoriesArgs): Promise<PaginatedList<MemoryRecord>>;
  storeMemory(args: StoreMemoryArgs): Promise<MemoryRecord>;
  getMemory(memoryId: string): Promise<MemoryRecord>;
  supersedeMemory(memoryId: string): Promise<ToolOperationResult>;
  archiveMemory(memoryId: string): Promise<ToolOperationResult>;
}

export interface ToolExecutor {
  executeToolCall(toolName: string, toolArgs: MetadataMap): Promise<unknown>;
}

export interface ParticipantTools extends RoomParticipantTools, PeerLookupTools {}

/** Full tool surface available to framework adapters during message handling. */
export interface AdapterToolsProtocol
  extends
    MessagingTools,
    RoomParticipantTools,
    ToolSchemaProvider,
    ToolExecutor,
    Partial<PeerLookupTools>,
    Partial<ContactTools>,
    Partial<MemoryTools> {
  /** Check capability flags to determine which optional tools are available. */
  readonly capabilities: Readonly<AgentToolsCapabilities>;
}

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
  hasMessage(messageId: string): boolean;
  recordMessage(message: PlatformMessageLike): void;
  getTools(): AdapterToolsProtocol;
  getRawHistory(): MetadataMap[];
  getHydratedHistory(excludeMessageId?: string): Promise<MetadataMap[]>;
  consumeParticipantsMessage(): string | null;
  consumeContactsMessage(): string | null;
  consumeBootstrap(): boolean;
  readonly isLlmInitialized: boolean;
  markLlmInitialized(): void;
  injectSystemMessage(message: string): void;
  consumeSystemMessages(): string[];
}

/** Contract that every adapter must satisfy. Implement via {@link SimpleAdapter} for convenience. */
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
