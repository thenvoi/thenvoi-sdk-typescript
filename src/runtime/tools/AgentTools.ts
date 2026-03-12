import { UnsupportedFeatureError, ValidationError } from "../../core/errors";
import type { AgentToolsRestApi } from "../../client/rest/types";
import { DEFAULT_REQUEST_OPTIONS } from "../../client/rest/requestOptions";
import { assertCapability } from "../capabilities";
import type {
  AddContactArgs,
  ContactRecord,
  ContactRequestsResult,
  ListContactRequestsArgs,
  ListContactsArgs,
  ListMemoriesArgs,
  MemoryRecord,
  MentionInput,
  MentionReference,
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
import {
  type AdapterToolsProtocol,
  DEFAULT_AGENT_TOOLS_CAPABILITIES,
  type AgentToolsCapabilities,
  type AgentToolsProtocol,
} from "../../contracts/protocols";
import { assertChatEventType, CHAT_EVENT_TYPES } from "../messages";
import {
  CHAT_TOOL_NAMES,
  MEMORY_TOOL_NAMES,
  getToolDescription,
  TOOL_MODELS
} from "./schemas";

interface AgentToolsOptions {
  roomId: string;
  rest: AgentToolsRestApi;
  participants?: ParticipantRecord[];
  capabilities?: Partial<AgentToolsCapabilities>;
}

type ToolHandler = (arguments_: MetadataMap) => Promise<unknown>;

type AdapterToolMethodName =
  | "sendMessage"
  | "sendEvent"
  | "addParticipant"
  | "removeParticipant"
  | "getParticipants"
  | "createChatroom"
  | "getToolSchemas"
  | "getAnthropicToolSchemas"
  | "getOpenAIToolSchemas"
  | "executeToolCall"
  | "lookupPeers"
  | "listContacts"
  | "addContact"
  | "removeContact"
  | "listContactRequests"
  | "respondContactRequest"
  | "listMemories"
  | "storeMemory"
  | "getMemory"
  | "supersedeMemory"
  | "archiveMemory";

const REQUIRED_ADAPTER_TOOL_METHODS = [
  "sendMessage",
  "sendEvent",
  "addParticipant",
  "removeParticipant",
  "getParticipants",
  "createChatroom",
  "getToolSchemas",
  "getAnthropicToolSchemas",
  "getOpenAIToolSchemas",
  "executeToolCall",
] as const satisfies readonly AdapterToolMethodName[];

const OPTIONAL_ADAPTER_TOOL_METHODS: Record<keyof AgentToolsCapabilities, readonly AdapterToolMethodName[]> = {
  peers: ["lookupPeers"],
  contacts: [
    "listContacts",
    "addContact",
    "removeContact",
    "listContactRequests",
    "respondContactRequest",
  ],
  memory: [
    "listMemories",
    "storeMemory",
    "getMemory",
    "supersedeMemory",
    "archiveMemory",
  ],
};

const CONTACT_REQUEST_ACTIONS: ReadonlySet<RespondContactRequestArgs["action"]> = new Set([
  "approve",
  "reject",
  "cancel",
]);

export class AgentTools implements AgentToolsProtocol {
  public readonly roomId: string;
  public readonly capabilities: Readonly<AgentToolsCapabilities>;
  private readonly rest: AgentToolsRestApi;
  private participants: ParticipantRecord[];
  private readonly adapterTools: AdapterToolsProtocol;
  private readonly toolHandlers: Record<string, ToolHandler>;

  public constructor(options: AgentToolsOptions) {
    this.roomId = options.roomId;
    this.rest = options.rest;
    this.participants = options.participants ?? [];
    this.capabilities = {
      ...DEFAULT_AGENT_TOOLS_CAPABILITIES,
      ...options.capabilities,
    };
    this.toolHandlers = this.buildToolHandlers();
    this.adapterTools = this.buildAdapterTools();
  }

  public getAdapterTools(): AdapterToolsProtocol {
    return this.adapterTools;
  }

  public async sendMessage(
    content: string,
    mentions: MentionInput = [],
  ): Promise<ToolOperationResult> {
    if (mentions.length > 0 && typeof mentions[0] === "string" && this.participants.length === 0) {
      await this.refreshParticipants();
    }

    const resolvedMentions = this.resolveMentions(mentions);

    return this.rest.createChatMessage(
      this.roomId,
      {
        content,
        mentions: resolvedMentions,
      },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public async sendEvent(
    content: string,
    messageType: string,
    metadata?: MetadataMap,
  ): Promise<ToolOperationResult> {
    assertChatEventType(messageType);
    return this.rest.createChatEvent(
      this.roomId,
      {
        content,
        messageType,
        metadata,
      },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public async createChatroom(taskId?: string): Promise<string> {
    const room = await this.rest.createChat(taskId, DEFAULT_REQUEST_OPTIONS);
    return room.id;
  }

  public async addParticipant(name: string, role = "member"): Promise<ToolOperationResult> {
    const existing = await this.refreshParticipants();
    const alreadyInRoom = existing.find(
      (participant) => String(participant.name ?? "").toLowerCase() === name.toLowerCase(),
    );
    if (alreadyInRoom) {
      return {
        ...alreadyInRoom,
        status: "already_in_room",
      };
    }

    const peer = await this.lookupPeerByName(name);
    if (!peer?.id) {
      throw new UnsupportedFeatureError(
        `Participant '${name}' not found. lookupPeers requires peer endpoint availability.`,
      );
    }

    await this.rest.addChatParticipant(
      this.roomId,
      {
        participantId: String(peer.id),
        role,
      },
      DEFAULT_REQUEST_OPTIONS,
    );

    const participantRecord = {
      id: String(peer.id),
      name,
      role,
      type: String(peer.type ?? "Agent"),
      handle: (peer.handle as string | undefined) ?? null,
    };

    this.participants.push(participantRecord);

    return {
      ...participantRecord,
      status: "added",
    };
  }

  public async removeParticipant(name: string): Promise<ToolOperationResult> {
    const participants = await this.refreshParticipants();
    const participant = participants.find(
      (entry) => String(entry.name ?? "").toLowerCase() === name.toLowerCase(),
    );

    if (!participant?.id) {
      throw new ValidationError(`Participant '${name}' not found in room`);
    }

    await this.rest.removeChatParticipant(this.roomId, String(participant.id), DEFAULT_REQUEST_OPTIONS);
    this.replaceParticipants(this.participants.filter((entry) => entry.id !== participant.id));

    return {
      id: participant.id,
      name,
      status: "removed",
    };
  }

  public async lookupPeers(page = 1, pageSize = 50): Promise<PaginatedList<PeerRecord>> {
    assertCapability(this.capabilities, "peers");
    if (!this.rest.listPeers) {
      throw new UnsupportedFeatureError(
        "Peer listing is not available in current REST adapter",
      );
    }

    return this.rest.listPeers(
      {
        page,
        pageSize,
        notInChat: this.roomId,
      },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public async getParticipants(): Promise<ParticipantRecord[]> {
    return [...this.participants];
  }

  private async refreshParticipants(): Promise<ParticipantRecord[]> {
    const participants = await this.rest.listChatParticipants(this.roomId, DEFAULT_REQUEST_OPTIONS);
    const normalized = participants.map((participant) => ({
      id: participant.id,
      name: participant.name,
      type: participant.type,
      handle: participant.handle ?? null,
    }));
    this.replaceParticipants(normalized);
    return [...this.participants];
  }

  public async executeToolCall(toolName: string, arguments_: MetadataMap): Promise<unknown> {
    const validationError = validateToolArgs(toolName, arguments_);
    if (validationError) {
      return validationError;
    }

    const handler = this.toolHandlers[toolName];
    if (!handler) {
      return `Unknown tool: ${toolName}`;
    }

    try {
      return await handler(arguments_);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error executing ${toolName}: ${message}`;
    }
  }

  public getToolSchemas(format: "openai" | "anthropic", options?: { includeMemory?: boolean }): ToolSchemaRecord[] {
    const includeMemory = options?.includeMemory ?? false;

    const tools = Object.entries(TOOL_MODELS)
      .filter(([name]) => {
        if (MEMORY_TOOL_NAMES.has(name)) {
          return includeMemory && this.capabilities.memory;
        }

        if (!CHAT_TOOL_NAMES.has(name) && !this.capabilities.contacts) {
          return false;
        }

        if (name === "thenvoi_lookup_peers" && !this.capabilities.peers) {
          return false;
        }

        return true;
      })
      .map(([name, model]) => {
        if (format === "anthropic") {
          return {
            name,
            description: getToolDescription(name),
            input_schema: {
              type: "object",
              properties: model.properties,
              required: model.required,
            },
          };
        }

        return {
          type: "function",
          function: {
            name,
            description: getToolDescription(name),
            parameters: {
              type: "object",
              properties: model.properties,
              required: model.required,
            },
          },
        };
      });

    return tools;
  }

  public getAnthropicToolSchemas(options?: { includeMemory?: boolean }): ToolSchemaRecord[] {
    return this.getToolSchemas("anthropic", options);
  }

  public getOpenAIToolSchemas(options?: { includeMemory?: boolean }): ToolSchemaRecord[] {
    return this.getToolSchemas("openai", options);
  }

  public async listContacts(request: ListContactsArgs = {}): Promise<PaginatedList<ContactRecord>> {
    assertCapability(this.capabilities, "contacts");
    if (!this.rest.listContacts) {
      throw new UnsupportedFeatureError("Contact listing is not available in current REST adapter");
    }

    const page = request.page ?? 1;
    const pageSize = request.pageSize ?? 50;

    return this.rest.listContacts(
      {
        page,
        pageSize,
      },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public async addContact(request: AddContactArgs): Promise<ToolOperationResult> {
    assertCapability(this.capabilities, "contacts");
    if (!this.rest.addContact) {
      throw new UnsupportedFeatureError("Contact creation is not available in current REST adapter");
    }

    const normalizedHandle = request.handle.trim();
    if (normalizedHandle.length === 0) {
      throw new ValidationError("handle is required");
    }

    return this.rest.addContact(
      {
        handle: normalizedHandle,
        ...(request.message ? { message: request.message } : {}),
      },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public async removeContact(request: RemoveContactArgs): Promise<ToolOperationResult> {
    assertCapability(this.capabilities, "contacts");
    if (!this.rest.removeContact) {
      throw new UnsupportedFeatureError("Contact removal is not available in current REST adapter");
    }

    if (request.target === "handle") {
      const handle = request.handle.trim();
      if (handle.length === 0) {
        throw new ValidationError("handle is required");
      }

      return this.rest.removeContact(
        {
          target: "handle",
          handle,
        },
        DEFAULT_REQUEST_OPTIONS,
      );
    }

    const contactId = request.contactId.trim();
    if (contactId.length === 0) {
      throw new ValidationError("contactId is required");
    }

    return this.rest.removeContact(
      {
        target: "contactId",
        contactId,
      },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public async listContactRequests(
    request: ListContactRequestsArgs = {},
  ): Promise<ContactRequestsResult> {
    assertCapability(this.capabilities, "contacts");
    if (!this.rest.listContactRequests) {
      throw new UnsupportedFeatureError("Contact request listing is not available in current REST adapter");
    }

    const page = request.page ?? 1;
    const pageSize = request.pageSize ?? 50;
    const sentStatus = request.sentStatus ?? "pending";

    return this.rest.listContactRequests(
      {
        page,
        pageSize,
        sentStatus,
      },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public async respondContactRequest(request: RespondContactRequestArgs): Promise<ToolOperationResult> {
    assertCapability(this.capabilities, "contacts");
    if (!this.rest.respondContactRequest) {
      throw new UnsupportedFeatureError("Contact request responses are not available in current REST adapter");
    }

    if (request.target === "handle") {
      const handle = request.handle.trim();
      if (handle.length === 0) {
        throw new ValidationError("handle is required");
      }

      return this.rest.respondContactRequest(
        {
          action: request.action,
          target: "handle",
          handle,
        },
        DEFAULT_REQUEST_OPTIONS,
      );
    }

    const requestId = request.requestId.trim();
    if (requestId.length === 0) {
      throw new ValidationError("requestId is required");
    }

    return this.rest.respondContactRequest(
      {
        action: request.action,
        target: "requestId",
        requestId,
      },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public async listMemories(args: ListMemoriesArgs = {}): Promise<PaginatedList<MemoryRecord>> {
    assertCapability(this.capabilities, "memory");
    if (!this.rest.listMemories) {
      throw new UnsupportedFeatureError("Memory listing is not available in current REST adapter");
    }

    return this.rest.listMemories(args, DEFAULT_REQUEST_OPTIONS);
  }

  public async storeMemory(args: StoreMemoryArgs): Promise<MemoryRecord> {
    assertCapability(this.capabilities, "memory");
    if (!this.rest.storeMemory) {
      throw new UnsupportedFeatureError("Memory creation is not available in current REST adapter");
    }

    return this.rest.storeMemory(args, DEFAULT_REQUEST_OPTIONS);
  }

  public async getMemory(memoryId: string): Promise<MemoryRecord> {
    assertCapability(this.capabilities, "memory");
    if (!this.rest.getMemory) {
      throw new UnsupportedFeatureError("Memory lookup is not available in current REST adapter");
    }

    const normalizedMemoryId = memoryId.trim();
    if (normalizedMemoryId.length === 0) {
      throw new ValidationError("memoryId is required");
    }

    return this.rest.getMemory(normalizedMemoryId, DEFAULT_REQUEST_OPTIONS);
  }

  public async supersedeMemory(memoryId: string): Promise<ToolOperationResult> {
    assertCapability(this.capabilities, "memory");
    if (!this.rest.supersedeMemory) {
      throw new UnsupportedFeatureError("Memory supersede is not available in current REST adapter");
    }

    const normalizedMemoryId = memoryId.trim();
    if (normalizedMemoryId.length === 0) {
      throw new ValidationError("memoryId is required");
    }

    return this.rest.supersedeMemory(normalizedMemoryId, DEFAULT_REQUEST_OPTIONS);
  }

  public async archiveMemory(memoryId: string): Promise<ToolOperationResult> {
    assertCapability(this.capabilities, "memory");
    if (!this.rest.archiveMemory) {
      throw new UnsupportedFeatureError("Memory archive is not available in current REST adapter");
    }

    const normalizedMemoryId = memoryId.trim();
    if (normalizedMemoryId.length === 0) {
      throw new ValidationError("memoryId is required");
    }

    return this.rest.archiveMemory(normalizedMemoryId, DEFAULT_REQUEST_OPTIONS);
  }

  private resolveMentions(
    mentions: MentionInput,
  ): MentionReference[] {
    if (mentions.length === 0) {
      return [];
    }

    if (typeof mentions[0] !== "string") {
      return mentions as MentionReference[];
    }

    const participantsByHandle = new Map<string, MentionReference>();
    const participantsById = new Map<string, MentionReference>();
    const participantsByName = new Map<string, MentionReference>();
    for (const participant of this.participants) {
      const ref: MentionReference = {
        id: String(participant.id),
        handle: typeof participant.handle === "string" ? participant.handle : undefined,
      };
      participantsById.set(ref.id, ref);
      const handle = participant.handle;
      if (typeof handle === "string") {
        participantsByHandle.set(this.normalizeMentionHandle(handle), ref);
      }
      const name = participant.name;
      if (typeof name === "string" && name.trim().length > 0) {
        participantsByName.set(name.trim().toLowerCase(), ref);
      }
    }

    return (mentions as string[]).map((mention) => {
      // Try by ID first (UUID strings), then by handle, then by display name.
      const byId = participantsById.get(mention);
      if (byId) {
        return byId;
      }

      const normalized = this.normalizeMentionHandle(mention);
      const found = participantsByHandle.get(normalized);
      if (found) {
        return found;
      }

      const byName = participantsByName.get(mention.trim().toLowerCase());
      if (byName) {
        return byName;
      }

      throw new ValidationError(`Mention '${mention}' not found in participants`);
    });
  }

  private async lookupPeerByName(name: string): Promise<PeerRecord | null> {
    const target = name.trim().toLowerCase();
    const pageSize = 100;
    const maxPages = 25;

    for (let page = 1; page <= maxPages; page += 1) {
      const peers = await this.lookupPeers(page, pageSize);
      const items = peers.data ?? [];
      const match = items.find((peer) => String(peer.name ?? "").toLowerCase() === target);
      if (match) {
        return match;
      }

      const totalPages = peers.metadata?.totalPages;
      if (typeof totalPages === "number" && totalPages > 0 && page >= totalPages) {
        break;
      }

      if ((typeof totalPages !== "number" || totalPages <= 0) && items.length < pageSize) {
        break;
      }
    }

    return null;
  }

  private normalizeMentionHandle(handle: string): string {
    return handle.trim().replace(/^@+/, "").toLowerCase();
  }

  private replaceParticipants(participants: ParticipantRecord[]): void {
    this.participants.splice(0, this.participants.length, ...participants);
  }

  private buildAdapterTools(): AdapterToolsProtocol {
    const tools: Partial<AdapterToolsProtocol> = {
      capabilities: this.capabilities,
    };

    for (const methodName of REQUIRED_ADAPTER_TOOL_METHODS) {
      (tools as Record<string, unknown>)[methodName] = this.bindAdapterToolMethod(methodName);
    }

    for (const [capabilityKey, methodNames] of Object.entries(OPTIONAL_ADAPTER_TOOL_METHODS) as
      Array<[keyof AgentToolsCapabilities, readonly AdapterToolMethodName[]]>) {
      if (!this.capabilities[capabilityKey]) {
        continue;
      }
      for (const methodName of methodNames) {
        (tools as Record<string, unknown>)[methodName] = this.bindAdapterToolMethod(methodName);
      }
    }

    return Object.freeze(tools) as AdapterToolsProtocol;
  }

  private bindAdapterToolMethod<K extends AdapterToolMethodName>(methodName: K): AdapterToolsProtocol[K] {
    const method = this[methodName] as unknown as (...args: unknown[]) => unknown;
    return method.bind(this) as AdapterToolsProtocol[K];
  }

  private buildToolHandlers(): Record<string, ToolHandler> {
    return {
      ...this.buildMessagingToolHandlers(),
      ...this.buildContactToolHandlers(),
      ...this.buildMemoryToolHandlers(),
    };
  }

  private buildMessagingToolHandlers(): Record<string, ToolHandler> {
    return {
      thenvoi_send_message: async (arguments_) =>
        this.sendMessage(
          String(arguments_.content ?? ""),
          (arguments_.mentions as string[] | Array<{ id: string; handle?: string }>) ?? [],
        ),
      thenvoi_send_event: async (arguments_) =>
        this.sendEvent(
          String(arguments_.content ?? ""),
          String(arguments_.message_type ?? "task"),
          (arguments_.metadata as MetadataMap | undefined) ?? undefined,
        ),
      thenvoi_add_participant: async (arguments_) =>
        this.addParticipant(String(arguments_.name ?? ""), String(arguments_.role ?? "member")),
      thenvoi_remove_participant: async (arguments_) =>
        this.removeParticipant(String(arguments_.name ?? "")),
      thenvoi_lookup_peers: async (arguments_) =>
        this.lookupPeers(Number(arguments_.page ?? 1), Number(arguments_.page_size ?? 50)),
      thenvoi_get_participants: async () => this.refreshParticipants(),
      thenvoi_create_chatroom: async (arguments_) =>
        this.createChatroom(arguments_.task_id as string | undefined),
    };
  }

  private buildContactToolHandlers(): Record<string, ToolHandler> {
    return {
      thenvoi_list_contacts: async (arguments_) =>
        this.listContacts({
          page: Number(arguments_.page ?? 1),
          pageSize: Number(arguments_.page_size ?? 50),
        }),
      thenvoi_add_contact: async (arguments_) =>
        this.addContact({
          handle: String(arguments_.handle ?? ""),
          ...(typeof arguments_.message === "string" ? { message: arguments_.message } : {}),
        }),
      thenvoi_remove_contact: async (arguments_) =>
        this.removeContact(this.toRemoveContactArgs(arguments_)),
      thenvoi_list_contact_requests: async (arguments_) =>
        this.listContactRequests({
          page: Number(arguments_.page ?? 1),
          pageSize: Number(arguments_.page_size ?? 50),
          sentStatus: String(arguments_.sent_status ?? "pending"),
        }),
      thenvoi_respond_contact_request: async (arguments_) =>
        this.respondContactRequest(this.toRespondContactRequestArgs(arguments_)),
    };
  }

  private buildMemoryToolHandlers(): Record<string, ToolHandler> {
    return {
      thenvoi_list_memories: async (arguments_) =>
        this.listMemories(arguments_ as unknown as ListMemoriesArgs),
      thenvoi_store_memory: async (arguments_) =>
        this.storeMemory(arguments_ as unknown as StoreMemoryArgs),
      thenvoi_get_memory: async (arguments_) =>
        this.getMemory(String(arguments_.memory_id ?? "")),
      thenvoi_supersede_memory: async (arguments_) =>
        this.supersedeMemory(String(arguments_.memory_id ?? "")),
      thenvoi_archive_memory: async (arguments_) =>
        this.archiveMemory(String(arguments_.memory_id ?? "")),
    };
  }

  private toRemoveContactArgs(arguments_: MetadataMap): RemoveContactArgs {
    const handle = this.normalizeOptionalString(arguments_.handle);
    const contactId = this.normalizeOptionalString(arguments_.contact_id);
    if ((handle && contactId) || (!handle && !contactId)) {
      throw new ValidationError("Provide exactly one of handle or contact_id");
    }

    if (handle) {
      return {
        target: "handle",
        handle,
      };
    }

    return {
      target: "contactId",
      contactId: contactId as string,
    };
  }

  private toRespondContactRequestArgs(arguments_: MetadataMap): RespondContactRequestArgs {
    const action = this.normalizeOptionalString(arguments_.action);
    if (!action || !CONTACT_REQUEST_ACTIONS.has(action as RespondContactRequestArgs["action"])) {
      throw new ValidationError("action must be one of: approve, reject, cancel");
    }

    const handle = this.normalizeOptionalString(arguments_.handle);
    const requestId = this.normalizeOptionalString(arguments_.request_id);
    if ((handle && requestId) || (!handle && !requestId)) {
      throw new ValidationError("Provide exactly one of handle or request_id");
    }

    if (handle) {
      return {
        action: action as RespondContactRequestArgs["action"],
        target: "handle",
        handle,
      };
    }

    return {
      action: action as RespondContactRequestArgs["action"],
      target: "requestId",
      requestId: requestId as string,
    };
  }

  private normalizeOptionalString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }
}

/**
 * Validate tool arguments before execution.
 * Returns an LLM-friendly error string if validation fails, or null if valid.
 */
function validateToolArgs(toolName: string, args: Record<string, unknown>): string | null {
  const errors: string[] = [];

  const model = TOOL_MODELS[toolName as keyof typeof TOOL_MODELS];
  if (!model) {
    return null;
  }

  for (const field of model.required) {
    if (args[field] === undefined || args[field] === null) {
      errors.push(`${field}: Field required`);
    }
  }

  if (toolName === "thenvoi_send_message") {
    const mentions = args.mentions;
    if (Array.isArray(mentions) && mentions.length === 0) {
      errors.push("mentions: At least one mention is required");
    }
  }

  if (toolName === "thenvoi_send_event") {
    const messageType = args.message_type;
    if (typeof messageType === "string" && !(CHAT_EVENT_TYPES as readonly string[]).includes(messageType)) {
      errors.push(
        `message_type: Invalid value '${messageType}'. Expected one of: ${[...CHAT_EVENT_TYPES].join(", ")}`,
      );
    }
  }

  if (toolName === "thenvoi_respond_contact_request") {
    const action = args.action;
    const validActions = ["approve", "reject", "cancel"];
    if (typeof action === "string" && !validActions.includes(action)) {
      errors.push(
        `action: Invalid value '${action}'. Expected one of: ${validActions.join(", ")}`,
      );
    }
  }

  if (toolName === "thenvoi_store_memory") {
    const validSystems = ["sensory", "working", "long_term"];
    const validTypes = ["iconic", "echoic", "haptic", "episodic", "semantic", "procedural"];
    const validSegments = ["user", "agent", "tool", "guideline"];

    if (typeof args.system === "string" && !validSystems.includes(args.system)) {
      errors.push(`system: Invalid value '${args.system}'. Expected one of: ${validSystems.join(", ")}`);
    }
    if (typeof args.type === "string" && !validTypes.includes(args.type)) {
      errors.push(`type: Invalid value '${args.type}'. Expected one of: ${validTypes.join(", ")}`);
    }
    if (typeof args.segment === "string" && !validSegments.includes(args.segment)) {
      errors.push(`segment: Invalid value '${args.segment}'. Expected one of: ${validSegments.join(", ")}`);
    }
  }

  if (errors.length > 0) {
    return `Invalid arguments for ${toolName}: ${errors.join("; ")}`;
  }

  return null;
}
