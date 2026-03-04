import { UnsupportedFeatureError } from "../../core/errors";
import type { AgentToolsRestApi } from "../../client/rest/types";
import { DEFAULT_REQUEST_OPTIONS } from "../../client/rest/requestOptions";
import { assertCapability } from "../capabilities";
import type {
  ContactRecord,
  ContactRequestRecord,
  MemoryRecord,
  MentionInput,
  MentionReference,
  MetadataMap,
  PaginatedList,
  ParticipantRecord,
  PeerRecord,
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
  assertFeatureEnabled,
  getToolDescription,
  TOOL_MODELS,
} from "./schemas";

interface AgentToolsOptions {
  roomId: string;
  rest: AgentToolsRestApi;
  participants?: ParticipantRecord[];
  capabilities?: Partial<AgentToolsCapabilities>;
}

export class AgentTools implements AgentToolsProtocol {
  public readonly roomId: string;
  public readonly capabilities: Readonly<AgentToolsCapabilities>;
  private readonly rest: AgentToolsRestApi;
  private participants: ParticipantRecord[];
  private readonly adapterTools: AdapterToolsProtocol;

  public constructor(options: AgentToolsOptions) {
    this.roomId = options.roomId;
    this.rest = options.rest;
    this.participants = options.participants ?? [];
    this.capabilities = {
      ...DEFAULT_AGENT_TOOLS_CAPABILITIES,
      ...options.capabilities,
    };
    this.adapterTools = this.buildAdapterTools();
  }

  public getAdapterTools(): AdapterToolsProtocol {
    return this.adapterTools;
  }

  public async sendMessage(
    content: string,
    mentions: MentionInput = [],
  ): Promise<ToolOperationResult> {
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
    const existing = await this.getParticipants();
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
    const participants = await this.getParticipants();
    const participant = participants.find(
      (entry) => String(entry.name ?? "").toLowerCase() === name.toLowerCase(),
    );

    if (!participant?.id) {
      throw new Error(`Participant '${name}' not found in room`);
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
    const participants = await this.rest.listChatParticipants(this.roomId, DEFAULT_REQUEST_OPTIONS);
    const normalized = participants.map((participant) => ({
      id: participant.id,
      name: participant.name,
      type: participant.type,
      handle: participant.handle ?? null,
    }));
    this.replaceParticipants(normalized);
    return normalized;
  }

  public async executeToolCall(toolName: string, arguments_: MetadataMap): Promise<unknown> {
    const validationError = validateToolArgs(toolName, arguments_);
    if (validationError) {
      return validationError;
    }

    const handlers: Record<string, () => Promise<unknown>> = {
      thenvoi_send_message: () =>
        this.sendMessage(
          String(arguments_.content ?? ""),
          (arguments_.mentions as string[] | Array<{ id: string; handle?: string }>) ?? [],
        ),
      thenvoi_send_event: () =>
        this.sendEvent(
          String(arguments_.content ?? ""),
          String(arguments_.message_type ?? "task"),
          (arguments_.metadata as MetadataMap | undefined) ?? undefined,
        ),
      thenvoi_add_participant: () =>
        this.addParticipant(String(arguments_.name ?? ""), String(arguments_.role ?? "member")),
      thenvoi_remove_participant: () => this.removeParticipant(String(arguments_.name ?? "")),
      thenvoi_lookup_peers: () =>
        this.lookupPeers(Number(arguments_.page ?? 1), Number(arguments_.page_size ?? 50)),
      thenvoi_get_participants: () => this.getParticipants(),
      thenvoi_create_chatroom: () => this.createChatroom(arguments_.task_id as string | undefined),
      thenvoi_list_contacts: () =>
        this.listContacts(Number(arguments_.page ?? 1), Number(arguments_.page_size ?? 50)),
      thenvoi_add_contact: () =>
        this.addContact(String(arguments_.handle ?? ""), arguments_.message as string | undefined),
      thenvoi_remove_contact: () =>
        this.removeContact(
          arguments_.handle as string | undefined,
          arguments_.contact_id as string | undefined,
        ),
      thenvoi_list_contact_requests: () =>
        this.listContactRequests(
          Number(arguments_.page ?? 1),
          Number(arguments_.page_size ?? 50),
          String(arguments_.sent_status ?? "pending"),
        ),
      thenvoi_respond_contact_request: () =>
        this.respondContactRequest(
          String(arguments_.action ?? ""),
          arguments_.handle as string | undefined,
          arguments_.request_id as string | undefined,
        ),
      thenvoi_list_memories: () => this.listMemories(arguments_),
      thenvoi_store_memory: () => this.storeMemory(arguments_),
      thenvoi_get_memory: () => this.getMemory(String(arguments_.memory_id ?? "")),
      thenvoi_supersede_memory: () => this.supersedeMemory(String(arguments_.memory_id ?? "")),
      thenvoi_archive_memory: () => this.archiveMemory(String(arguments_.memory_id ?? "")),
    };

    const handler = handlers[toolName];
    if (!handler) {
      return `Unknown tool: ${toolName}`;
    }

    try {
      return await handler();
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

  public async listContacts(_page = 1, _pageSize = 50): Promise<PaginatedList<ContactRecord>> {
    this.throwUnsupportedContacts();
  }

  public async addContact(_handle: string, _message?: string): Promise<ToolOperationResult> {
    this.throwUnsupportedContacts();
  }

  public async removeContact(_handle?: string, _contactId?: string): Promise<ToolOperationResult> {
    this.throwUnsupportedContacts();
  }

  public async listContactRequests(
    _page = 1,
    _pageSize = 50,
    _sentStatus = "pending",
  ): Promise<PaginatedList<ContactRequestRecord>> {
    this.throwUnsupportedContacts();
  }

  public async respondContactRequest(
    _action: string,
    _handle?: string,
    _requestId?: string,
  ): Promise<ToolOperationResult> {
    this.throwUnsupportedContacts();
  }

  public async listMemories(_args: MetadataMap = {}): Promise<PaginatedList<MemoryRecord>> {
    this.throwUnsupportedMemory();
  }

  public async storeMemory(_args: MetadataMap): Promise<ToolOperationResult> {
    this.throwUnsupportedMemory();
  }

  public async getMemory(_memoryId: string): Promise<ToolOperationResult> {
    this.throwUnsupportedMemory();
  }

  public async supersedeMemory(_memoryId: string): Promise<ToolOperationResult> {
    this.throwUnsupportedMemory();
  }

  public async archiveMemory(_memoryId: string): Promise<ToolOperationResult> {
    this.throwUnsupportedMemory();
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
    }

    return (mentions as string[]).map((mention) => {
      // Try by ID first (UUID strings), then by handle
      const byId = participantsById.get(mention);
      if (byId) {
        return byId;
      }

      const normalized = this.normalizeMentionHandle(mention);
      const found = participantsByHandle.get(normalized);
      if (!found) {
        throw new Error(`Mention '${mention}' not found in participants`);
      }

      return found;
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

      // No totalPages metadata — stop if we got a partial page.
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

  private throwUnsupportedContacts(): never {
    assertCapability(this.capabilities, "contacts");
    throw new UnsupportedFeatureError(
      "Contact endpoints are not available in current fern-javascript-sdk snapshot",
    );
  }

  private throwUnsupportedMemory(): never {
    assertCapability(this.capabilities, "memory");
    throw new UnsupportedFeatureError(
      "Memory endpoints are not available in current fern-javascript-sdk snapshot",
    );
  }

  private buildAdapterTools(): AdapterToolsProtocol {
    const tools: AdapterToolsProtocol = {
      capabilities: this.capabilities,
      sendMessage: this.sendMessage.bind(this),
      sendEvent: this.sendEvent.bind(this),
      addParticipant: this.addParticipant.bind(this),
      removeParticipant: this.removeParticipant.bind(this),
      getParticipants: this.getParticipants.bind(this),
      createChatroom: this.createChatroom.bind(this),
      getToolSchemas: this.getToolSchemas.bind(this),
      getAnthropicToolSchemas: this.getAnthropicToolSchemas.bind(this),
      getOpenAIToolSchemas: this.getOpenAIToolSchemas.bind(this),
      executeToolCall: this.executeToolCall.bind(this),
    };

    if (this.capabilities.peers) {
      tools.lookupPeers = this.lookupPeers.bind(this);
    }

    if (this.capabilities.contacts) {
      tools.listContacts = this.listContacts.bind(this);
      tools.addContact = this.addContact.bind(this);
      tools.removeContact = this.removeContact.bind(this);
      tools.listContactRequests = this.listContactRequests.bind(this);
      tools.respondContactRequest = this.respondContactRequest.bind(this);
    }

    if (this.capabilities.memory) {
      tools.listMemories = this.listMemories.bind(this);
      tools.storeMemory = this.storeMemory.bind(this);
      tools.getMemory = this.getMemory.bind(this);
      tools.supersedeMemory = this.supersedeMemory.bind(this);
      tools.archiveMemory = this.archiveMemory.bind(this);
    }

    return Object.freeze(tools);
  }
}

/**
 * Validate tool arguments before execution.
 * Returns an LLM-friendly error string if validation fails, or null if valid.
 * Mirrors Python SDK's Pydantic validation pattern.
 */
function validateToolArgs(toolName: string, args: Record<string, unknown>): string | null {
  const errors: string[] = [];

  const model = TOOL_MODELS[toolName as keyof typeof TOOL_MODELS];
  if (!model) {
    return null;
  }

  // Check required fields
  for (const field of model.required) {
    if (args[field] === undefined || args[field] === null) {
      errors.push(`${field}: Field required`);
    }
  }

  // Tool-specific validations
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
