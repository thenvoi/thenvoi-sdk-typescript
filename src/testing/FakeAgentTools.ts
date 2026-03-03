import type {
  AdapterToolsProtocol,
  PeerLookupTools,
  ContactTools,
  MemoryTools,
} from "../contracts/protocols";
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
} from "../contracts/dtos";

interface CapturedMessage {
  content: string;
  mentions?: MentionInput;
}

interface CapturedEvent {
  content: string;
  messageType: string;
  metadata?: MetadataMap;
}

interface CapturedParticipant {
  name: string;
  role?: string;
}

interface CapturedToolCall {
  toolName: string;
  arguments: MetadataMap;
}

export class FakeAgentTools
  implements AdapterToolsProtocol, PeerLookupTools, ContactTools, MemoryTools
{
  public readonly messagesSent: CapturedMessage[] = [];
  public readonly eventsSent: CapturedEvent[] = [];
  public readonly participantsAdded: CapturedParticipant[] = [];
  public readonly participantsRemoved: string[] = [];
  public readonly toolCalls: CapturedToolCall[] = [];

  private messageCounter = 0;
  private eventCounter = 0;

  public async sendMessage(
    content: string,
    mentions?: MentionInput,
  ): Promise<ToolOperationResult> {
    this.messagesSent.push({ content, mentions });
    const id = `msg-${this.messageCounter++}`;
    return { id, status: "sent" };
  }

  public async sendEvent(
    content: string,
    messageType: string,
    metadata?: MetadataMap,
  ): Promise<ToolOperationResult> {
    this.eventsSent.push({ content, messageType, metadata });
    const id = `evt-${this.eventCounter++}`;
    return { id, status: "sent" };
  }

  public async addParticipant(
    name: string,
    role?: string,
  ): Promise<ToolOperationResult> {
    this.participantsAdded.push({ name, role });
    return { status: "ok" };
  }

  public async removeParticipant(name: string): Promise<ToolOperationResult> {
    this.participantsRemoved.push(name);
    return { status: "ok" };
  }

  public async getParticipants(): Promise<ParticipantRecord[]> {
    return [];
  }

  public async createChatroom(_taskId?: string): Promise<string> {
    return `room-${Date.now()}`;
  }

  public async lookupPeers(
    _page?: number,
    _pageSize?: number,
  ): Promise<PaginatedList<PeerRecord>> {
    return { data: [] };
  }

  public getToolSchemas(
    _format: "openai" | "anthropic",
    _options?: { includeMemory?: boolean },
  ): ToolSchemaRecord[] {
    return [];
  }

  public getAnthropicToolSchemas(
    _options?: { includeMemory?: boolean },
  ): ToolSchemaRecord[] {
    return [];
  }

  public getOpenAIToolSchemas(
    _options?: { includeMemory?: boolean },
  ): ToolSchemaRecord[] {
    return [];
  }

  public async executeToolCall(
    toolName: string,
    arguments_: MetadataMap,
  ): Promise<unknown> {
    this.toolCalls.push({ toolName, arguments: arguments_ });
    return { status: "ok" };
  }

  // Contact stubs
  public async listContacts(
    _page?: number,
    _pageSize?: number,
  ): Promise<PaginatedList<ContactRecord>> {
    return { data: [] };
  }

  public async addContact(
    _handle: string,
    _message?: string,
  ): Promise<ToolOperationResult> {
    return { status: "ok" };
  }

  public async removeContact(
    _handle?: string,
    _contactId?: string,
  ): Promise<ToolOperationResult> {
    return { status: "ok" };
  }

  public async listContactRequests(
    _page?: number,
    _pageSize?: number,
    _sentStatus?: string,
  ): Promise<PaginatedList<ContactRequestRecord>> {
    return { data: [] };
  }

  public async respondContactRequest(
    _action: string,
    _handle?: string,
    _requestId?: string,
  ): Promise<ToolOperationResult> {
    return { status: "ok" };
  }

  // Memory stubs
  public async listMemories(
    _args?: MetadataMap,
  ): Promise<PaginatedList<MemoryRecord>> {
    return { data: [] };
  }

  public async storeMemory(_args: MetadataMap): Promise<ToolOperationResult> {
    return { status: "ok" };
  }

  public async getMemory(_memoryId: string): Promise<ToolOperationResult> {
    return { status: "ok" };
  }

  public async supersedeMemory(
    _memoryId: string,
  ): Promise<ToolOperationResult> {
    return { status: "ok" };
  }

  public async archiveMemory(
    _memoryId: string,
  ): Promise<ToolOperationResult> {
    return { status: "ok" };
  }

  public reset(): void {
    this.messagesSent.length = 0;
    this.eventsSent.length = 0;
    this.participantsAdded.length = 0;
    this.participantsRemoved.length = 0;
    this.toolCalls.length = 0;
    this.messageCounter = 0;
    this.eventCounter = 0;
  }
}
