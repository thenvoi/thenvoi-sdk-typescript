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

type FakeToolMethod = keyof AdapterToolsProtocol;

export interface FakeAgentToolsOptions {
  failOn?: Iterable<FakeToolMethod>;
  errorFactory?: (method: FakeToolMethod) => Error;
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
  private readonly failOn: Set<FakeToolMethod>;
  private readonly errorFactory: (method: FakeToolMethod) => Error;

  public constructor(options?: FakeAgentToolsOptions) {
    this.failOn = new Set(options?.failOn ?? []);
    this.errorFactory =
      options?.errorFactory ??
      ((method) => new Error(`FakeAgentTools configured failure for ${String(method)}`));
  }

  public async sendMessage(
    content: string,
    mentions?: MentionInput,
  ): Promise<ToolOperationResult> {
    this.maybeFail("sendMessage");
    this.messagesSent.push({ content, mentions });
    const id = `msg-${this.messageCounter++}`;
    return { id, status: "sent" };
  }

  public async sendEvent(
    content: string,
    messageType: string,
    metadata?: MetadataMap,
  ): Promise<ToolOperationResult> {
    this.maybeFail("sendEvent");
    this.eventsSent.push({ content, messageType, metadata });
    const id = `evt-${this.eventCounter++}`;
    return { id, status: "sent" };
  }

  public async addParticipant(
    name: string,
    role?: string,
  ): Promise<ToolOperationResult> {
    this.maybeFail("addParticipant");
    this.participantsAdded.push({ name, role });
    return { status: "ok" };
  }

  public async removeParticipant(name: string): Promise<ToolOperationResult> {
    this.maybeFail("removeParticipant");
    this.participantsRemoved.push(name);
    return { status: "ok" };
  }

  public async getParticipants(): Promise<ParticipantRecord[]> {
    this.maybeFail("getParticipants");
    return [];
  }

  public async createChatroom(_taskId?: string): Promise<string> {
    this.maybeFail("createChatroom");
    return `room-${Date.now()}`;
  }

  public async lookupPeers(
    _page?: number,
    _pageSize?: number,
  ): Promise<PaginatedList<PeerRecord>> {
    this.maybeFail("lookupPeers");
    return { data: [] };
  }

  public getToolSchemas(
    _format: "openai" | "anthropic",
    _options?: { includeMemory?: boolean },
  ): ToolSchemaRecord[] {
    this.maybeFail("getToolSchemas");
    return [];
  }

  public getAnthropicToolSchemas(
    _options?: { includeMemory?: boolean },
  ): ToolSchemaRecord[] {
    this.maybeFail("getAnthropicToolSchemas");
    return [];
  }

  public getOpenAIToolSchemas(
    _options?: { includeMemory?: boolean },
  ): ToolSchemaRecord[] {
    this.maybeFail("getOpenAIToolSchemas");
    return [];
  }

  public async executeToolCall(
    toolName: string,
    arguments_: MetadataMap,
  ): Promise<unknown> {
    this.maybeFail("executeToolCall");
    this.toolCalls.push({ toolName, arguments: arguments_ });
    return { status: "ok" };
  }

  // Contact stubs
  public async listContacts(
    _page?: number,
    _pageSize?: number,
  ): Promise<PaginatedList<ContactRecord>> {
    this.maybeFail("listContacts");
    return { data: [] };
  }

  public async addContact(
    _handle: string,
    _message?: string,
  ): Promise<ToolOperationResult> {
    this.maybeFail("addContact");
    return { status: "ok" };
  }

  public async removeContact(
    _handle?: string,
    _contactId?: string,
  ): Promise<ToolOperationResult> {
    this.maybeFail("removeContact");
    return { status: "ok" };
  }

  public async listContactRequests(
    _page?: number,
    _pageSize?: number,
    _sentStatus?: string,
  ): Promise<PaginatedList<ContactRequestRecord>> {
    this.maybeFail("listContactRequests");
    return { data: [] };
  }

  public async respondContactRequest(
    _action: string,
    _handle?: string,
    _requestId?: string,
  ): Promise<ToolOperationResult> {
    this.maybeFail("respondContactRequest");
    return { status: "ok" };
  }

  // Memory stubs
  public async listMemories(
    _args?: MetadataMap,
  ): Promise<PaginatedList<MemoryRecord>> {
    this.maybeFail("listMemories");
    return { data: [] };
  }

  public async storeMemory(_args: MetadataMap): Promise<ToolOperationResult> {
    this.maybeFail("storeMemory");
    return { status: "ok" };
  }

  public async getMemory(_memoryId: string): Promise<ToolOperationResult> {
    this.maybeFail("getMemory");
    return { status: "ok" };
  }

  public async supersedeMemory(
    _memoryId: string,
  ): Promise<ToolOperationResult> {
    this.maybeFail("supersedeMemory");
    return { status: "ok" };
  }

  public async archiveMemory(
    _memoryId: string,
  ): Promise<ToolOperationResult> {
    this.maybeFail("archiveMemory");
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

  private maybeFail(method: FakeToolMethod): void {
    if (this.failOn.has(method)) {
      throw this.errorFactory(method);
    }
  }
}
