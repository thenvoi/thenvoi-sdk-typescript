import { DEFAULT_REQUEST_OPTIONS } from "../../client/rest/requestOptions";
import type {
  AgentToolsRestApi,
  ChatParticipant,
  ChatMessagingRestApi,
  ChatRoomRestApi,
  ContactRestApi,
} from "../../client/rest/types";
import type {
  AddContactArgs,
  ContactRecord,
  ContactRequestsResult,
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
} from "../../contracts/dtos";
import type {
  AdapterToolsProtocol,
  AgentToolsCapabilities,
} from "../../contracts/protocols";
import { UnsupportedFeatureError, ValidationError } from "../../core/errors";

type ContactCallbackRestApi =
  & Partial<AgentToolsRestApi>
  & Pick<ChatRoomRestApi, "createChat">
  & Partial<Pick<ChatMessagingRestApi, "createChatMessage" | "createChatEvent">>
  & Partial<ContactRestApi>;

function toParticipantRecord(participant: ChatParticipant): ParticipantRecord {
  return {
    id: participant.id,
    name: participant.name,
    type: participant.type,
    handle: participant.handle ?? null,
  };
}

function normalizePage(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value && value > 0 ? value : fallback;
}

function requireRoomId(roomId: string | null, methodName: string): string {
  if (roomId) {
    return roomId;
  }

  throw new UnsupportedFeatureError(`${methodName} is unavailable for contact callbacks without a room context`);
}

export class ContactCallbackTools implements AdapterToolsProtocol {
  public readonly capabilities: Readonly<AgentToolsCapabilities>;
  private readonly rest: ContactCallbackRestApi;
  private readonly roomId: string | null;

  public constructor(rest: ContactCallbackRestApi, roomId: string | null) {
    this.rest = rest;
    this.roomId = roomId;
    this.capabilities = Object.freeze({
      peers: Boolean(rest.listPeers),
      contacts: Boolean(
        rest.listContacts
        || rest.addContact
        || rest.removeContact
        || rest.listContactRequests
        || rest.respondContactRequest
      ),
      memory: Boolean(
        rest.listMemories
        || rest.storeMemory
        || rest.getMemory
        || rest.supersedeMemory
        || rest.archiveMemory
      ),
    });
  }

  public async sendMessage(
    content: string,
    mentions?: MentionInput,
  ): Promise<ToolOperationResult> {
    const roomId = requireRoomId(this.roomId, "sendMessage");
    if (!this.rest.createChatMessage) {
      throw new UnsupportedFeatureError("Message sending is not available in current REST adapter");
    }
    if (Array.isArray(mentions) && mentions.some((mention) => typeof mention === "string")) {
      throw new UnsupportedFeatureError("sendMessage string mentions are unavailable for contact callbacks");
    }

    const normalizedMentions = mentions && mentions.every((mention) => typeof mention !== "string")
      ? mentions
      : undefined;

    return this.rest.createChatMessage(
      roomId,
      {
        content,
        ...(normalizedMentions ? { mentions: normalizedMentions } : {}),
      },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public async sendEvent(
    content: string,
    messageType: string,
    metadata?: MetadataMap,
  ): Promise<ToolOperationResult> {
    const roomId = requireRoomId(this.roomId, "sendEvent");
    if (!this.rest.createChatEvent) {
      throw new UnsupportedFeatureError("Event sending is not available in current REST adapter");
    }
    return this.rest.createChatEvent(
      roomId,
      {
        content,
        messageType,
        ...(metadata ? { metadata } : {}),
      },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public async addParticipant(): Promise<ToolOperationResult> {
    throw new UnsupportedFeatureError("addParticipant is unavailable for contact callbacks");
  }

  public async removeParticipant(): Promise<ToolOperationResult> {
    throw new UnsupportedFeatureError("removeParticipant is unavailable for contact callbacks");
  }

  public async getParticipants(): Promise<ParticipantRecord[]> {
    const roomId = requireRoomId(this.roomId, "getParticipants");
    if (!this.rest.listChatParticipants) {
      throw new UnsupportedFeatureError("Participant listing is not available in current REST adapter");
    }
    return (await this.rest.listChatParticipants(roomId, DEFAULT_REQUEST_OPTIONS)).map(toParticipantRecord);
  }

  public async createChatroom(taskId?: string): Promise<string> {
    const chat = await this.rest.createChat(taskId, DEFAULT_REQUEST_OPTIONS);
    return chat.id;
  }

  public async lookupPeers(
    page = 1,
    pageSize = 50,
  ): Promise<PaginatedList<PeerRecord>> {
    if (!this.rest.listPeers) {
      throw new UnsupportedFeatureError("Peer lookup is not available in current REST adapter");
    }

    return this.rest.listPeers(
      {
        page: normalizePage(page, 1),
        pageSize: normalizePage(pageSize, 50),
        notInChat: this.roomId ?? "",
      },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public getToolSchemas(): ToolSchemaRecord[] {
    return [];
  }

  public getAnthropicToolSchemas(): ToolSchemaRecord[] {
    return [];
  }

  public getOpenAIToolSchemas(): ToolSchemaRecord[] {
    return [];
  }

  public async listContacts(request: ListContactsArgs = {}): Promise<PaginatedList<ContactRecord>> {
    if (!this.rest.listContacts) {
      throw new UnsupportedFeatureError("Contact listing is not available in current REST adapter");
    }

    return this.rest.listContacts(
      {
        page: request.page ?? 1,
        pageSize: request.pageSize ?? 50,
      },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public async addContact(request: AddContactArgs): Promise<ToolOperationResult> {
    if (!this.rest.addContact) {
      throw new UnsupportedFeatureError("Contact creation is not available in current REST adapter");
    }

    const handle = request.handle.trim();
    if (handle.length === 0) {
      throw new ValidationError("handle is required");
    }

    return this.rest.addContact(
      {
        handle,
        ...(request.message ? { message: request.message } : {}),
      },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public async removeContact(request: RemoveContactArgs): Promise<ToolOperationResult> {
    if (!this.rest.removeContact) {
      throw new UnsupportedFeatureError("Contact removal is not available in current REST adapter");
    }

    if (request.target === "handle") {
      const handle = request.handle.trim();
      if (handle.length === 0) {
        throw new ValidationError("handle is required");
      }

      return this.rest.removeContact(
        { target: "handle", handle },
        DEFAULT_REQUEST_OPTIONS,
      );
    }

    const contactId = request.contactId.trim();
    if (contactId.length === 0) {
      throw new ValidationError("contactId is required");
    }

    return this.rest.removeContact(
      { target: "contactId", contactId },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public async listContactRequests(
    request: ListContactRequestsArgs = {},
  ): Promise<ContactRequestsResult> {
    if (!this.rest.listContactRequests) {
      throw new UnsupportedFeatureError("Contact request listing is not available in current REST adapter");
    }

    return this.rest.listContactRequests(
      {
        page: request.page ?? 1,
        pageSize: request.pageSize ?? 50,
        sentStatus: request.sentStatus ?? "pending",
      },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public async respondContactRequest(request: RespondContactRequestArgs): Promise<ToolOperationResult> {
    if (!this.rest.respondContactRequest) {
      throw new UnsupportedFeatureError("Contact request responses are not available in current REST adapter");
    }

    if (request.target === "handle") {
      const handle = request.handle.trim();
      if (handle.length === 0) {
        throw new ValidationError("handle is required");
      }

      return this.rest.respondContactRequest(
        { action: request.action, target: "handle", handle },
        DEFAULT_REQUEST_OPTIONS,
      );
    }

    const requestId = request.requestId.trim();
    if (requestId.length === 0) {
      throw new ValidationError("requestId is required");
    }

    return this.rest.respondContactRequest(
      { action: request.action, target: "requestId", requestId },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public async listMemories(args: ListMemoriesArgs = {}): Promise<PaginatedList<MemoryRecord>> {
    if (!this.rest.listMemories) {
      throw new UnsupportedFeatureError("Memory listing is not available in current REST adapter");
    }

    return this.rest.listMemories(args, DEFAULT_REQUEST_OPTIONS);
  }

  public async storeMemory(args: StoreMemoryArgs): Promise<MemoryRecord> {
    if (!this.rest.storeMemory) {
      throw new UnsupportedFeatureError("Memory storage is not available in current REST adapter");
    }

    return this.rest.storeMemory(args, DEFAULT_REQUEST_OPTIONS);
  }

  public async getMemory(memoryId: string): Promise<MemoryRecord> {
    if (!this.rest.getMemory) {
      throw new UnsupportedFeatureError("Memory lookup is not available in current REST adapter");
    }

    return this.rest.getMemory(memoryId, DEFAULT_REQUEST_OPTIONS);
  }

  public async supersedeMemory(memoryId: string): Promise<ToolOperationResult> {
    if (!this.rest.supersedeMemory) {
      throw new UnsupportedFeatureError("Memory supersede is not available in current REST adapter");
    }

    return this.rest.supersedeMemory(memoryId, DEFAULT_REQUEST_OPTIONS);
  }

  public async archiveMemory(memoryId: string): Promise<ToolOperationResult> {
    if (!this.rest.archiveMemory) {
      throw new UnsupportedFeatureError("Memory archival is not available in current REST adapter");
    }

    return this.rest.archiveMemory(memoryId, DEFAULT_REQUEST_OPTIONS);
  }

  public async executeToolCall(toolName: string, toolArgs: MetadataMap): Promise<unknown> {
    switch (toolName) {
      case "thenvoi_send_message":
        return this.sendMessage(
          String(toolArgs.content ?? ""),
          toolArgs.mentions as MentionInput | undefined,
        );
      case "thenvoi_send_event":
        return this.sendEvent(
          String(toolArgs.content ?? ""),
          String(toolArgs.message_type ?? "task"),
          toolArgs.metadata as MetadataMap | undefined,
        );
      case "thenvoi_get_participants":
        return this.getParticipants();
      case "thenvoi_create_chatroom":
        return this.createChatroom(typeof toolArgs.task_id === "string" ? toolArgs.task_id : undefined);
      case "thenvoi_lookup_peers":
        return this.lookupPeers(
          typeof toolArgs.page === "number" ? toolArgs.page : undefined,
          typeof toolArgs.page_size === "number" ? toolArgs.page_size : undefined,
        );
      case "thenvoi_list_contacts":
        return this.listContacts({
          page: typeof toolArgs.page === "number" ? toolArgs.page : undefined,
          pageSize: typeof toolArgs.page_size === "number" ? toolArgs.page_size : undefined,
        });
      case "thenvoi_add_contact":
        return this.addContact({
          handle: String(toolArgs.handle ?? ""),
          ...(typeof toolArgs.message === "string" ? { message: toolArgs.message } : {}),
        });
      case "thenvoi_remove_contact":
        if (typeof toolArgs.contact_id === "string") {
          return this.removeContact({ target: "contactId", contactId: toolArgs.contact_id });
        }
        return this.removeContact({ target: "handle", handle: String(toolArgs.handle ?? "") });
      case "thenvoi_list_contact_requests":
        return this.listContactRequests({
          page: typeof toolArgs.page === "number" ? toolArgs.page : undefined,
          pageSize: typeof toolArgs.page_size === "number" ? toolArgs.page_size : undefined,
          sentStatus: typeof toolArgs.sent_status === "string" ? toolArgs.sent_status : undefined,
        });
      case "thenvoi_respond_contact_request":
        if (typeof toolArgs.request_id === "string") {
          return this.respondContactRequest({
            action: String(toolArgs.action ?? "approve") as RespondContactRequestArgs["action"],
            target: "requestId",
            requestId: toolArgs.request_id,
          });
        }
        return this.respondContactRequest({
          action: String(toolArgs.action ?? "approve") as RespondContactRequestArgs["action"],
          target: "handle",
          handle: String(toolArgs.handle ?? ""),
        });
      case "thenvoi_list_memories":
        return this.listMemories(toolArgs as ListMemoriesArgs);
      case "thenvoi_store_memory":
        return this.storeMemory(toolArgs as unknown as StoreMemoryArgs);
      case "thenvoi_get_memory":
        return this.getMemory(String(toolArgs.memory_id ?? ""));
      case "thenvoi_supersede_memory":
        return this.supersedeMemory(String(toolArgs.memory_id ?? ""));
      case "thenvoi_archive_memory":
        return this.archiveMemory(String(toolArgs.memory_id ?? ""));
      default:
        throw new UnsupportedFeatureError(`Unsupported tool call for contact callback: ${toolName}`);
    }
  }
}
