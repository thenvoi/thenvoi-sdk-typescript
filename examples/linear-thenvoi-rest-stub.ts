import type { PaginatedResponse, RestApi } from "../src/index";
import type { ChatParticipant } from "../src/client/rest/types";

interface ExamplePeer {
  id: string;
  name: string;
  handle: string;
}

interface CapturedRoomMessage {
  roomId: string;
  content: string;
  messageType?: string;
  metadata?: Record<string, unknown>;
}

export class LinearThenvoiExampleRestApi implements RestApi {
  public readonly peers: ExamplePeer[];
  public readonly roomMessages: CapturedRoomMessage[] = [];
  public readonly roomEvents: CapturedRoomMessage[] = [];

  private readonly rooms = new Set<string>();
  private readonly roomParticipants = new Map<string, ChatParticipant[]>();
  private roomCounter = 0;

  public constructor(options?: { peers?: ExamplePeer[] }) {
    this.peers = options?.peers ?? [
      { id: "peer-host", name: "linear-host", handle: "linear-host" },
      { id: "peer-research", name: "research-agent", handle: "research-agent" },
      { id: "peer-synth", name: "synthesis-agent", handle: "synthesis-agent" },
    ];
  }

  public async getAgentMe() {
    return {
      id: "agent-linear-thenvoi",
      name: "Linear Thenvoi Host",
      description: "Example host agent for Linear + Thenvoi",
    };
  }

  public async createChatMessage(
    chatId: string,
    message: {
      content: string;
      messageType?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>> {
    this.ensureRoom(chatId);
    this.roomMessages.push({
      roomId: chatId,
      content: message.content,
      messageType: message.messageType,
      metadata: message.metadata,
    });
    return { ok: true };
  }

  public async createChatEvent(
    chatId: string,
    event: {
      content: string;
      messageType: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>> {
    this.ensureRoom(chatId);
    this.roomEvents.push({
      roomId: chatId,
      content: event.content,
      messageType: event.messageType,
      metadata: event.metadata,
    });
    return { ok: true };
  }

  public async createChat(_taskId?: string): Promise<{ id: string }> {
    this.roomCounter += 1;
    const roomId = `room-${this.roomCounter}`;
    this.ensureRoom(roomId);
    return { id: roomId };
  }

  public async listChatParticipants(chatId: string): Promise<ChatParticipant[]> {
    this.ensureRoom(chatId);
    return [...(this.roomParticipants.get(chatId) ?? [])];
  }

  public async addChatParticipant(
    chatId: string,
    participant: { participantId: string; role: string },
  ): Promise<Record<string, unknown>> {
    this.ensureRoom(chatId);
    const peer = this.peers.find((candidate) => candidate.id === participant.participantId);
    if (!peer) {
      throw new Error(`Unknown peer id '${participant.participantId}'`);
    }

    const existing = this.roomParticipants.get(chatId) ?? [];
    if (existing.some((entry) => entry.id === peer.id)) {
      return { ok: true, status: "already_present" };
    }

    existing.push({
      id: peer.id,
      name: peer.name,
      handle: peer.handle,
      type: "Agent",
    });
    this.roomParticipants.set(chatId, existing);
    return { ok: true, role: participant.role };
  }

  public async removeChatParticipant(chatId: string, participantId: string): Promise<Record<string, unknown>> {
    this.ensureRoom(chatId);
    const existing = this.roomParticipants.get(chatId) ?? [];
    this.roomParticipants.set(
      chatId,
      existing.filter((entry) => entry.id !== participantId),
    );

    return { ok: true };
  }

  public async markMessageProcessing(): Promise<Record<string, unknown>> {
    return { ok: true };
  }

  public async markMessageProcessed(): Promise<Record<string, unknown>> {
    return { ok: true };
  }

  public async markMessageFailed(): Promise<Record<string, unknown>> {
    return { ok: true };
  }

  public async listPeers(request: {
    page: number;
    pageSize: number;
    notInChat: string;
  }): Promise<PaginatedResponse<Record<string, unknown>>> {
    const page = Math.max(1, request.page);
    const pageSize = Math.max(1, request.pageSize);
    const participants = new Set((this.roomParticipants.get(request.notInChat) ?? []).map((entry) => entry.id));
    const available = this.peers.filter((peer) => !participants.has(peer.id));

    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const slice = available.slice(start, end);

    return {
      data: slice.map((peer) => ({
        id: peer.id,
        name: peer.name,
        handle: peer.handle,
      })),
      metadata: {
        page,
        pageSize: pageSize,
        totalCount: available.length,
        totalPages: Math.max(1, Math.ceil(available.length / pageSize)),
      },
    };
  }

  private ensureRoom(roomId: string): void {
    if (this.rooms.has(roomId)) {
      return;
    }

    this.rooms.add(roomId);
    this.roomParticipants.set(roomId, []);
  }
}
