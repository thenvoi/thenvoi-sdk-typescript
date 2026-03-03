import type { AgentToolsRestApi } from "../client/rest/types";
import type { AdapterToolsProtocol, AgentToolsCapabilities } from "../contracts/protocols";
import type { MetadataMap, ParticipantRecord } from "../contracts/dtos";
import type { PlatformMessage } from "./types";
import { AgentTools } from "./tools/AgentTools";

interface ExecutionContextLink {
  rest: AgentToolsRestApi;
  capabilities?: Partial<AgentToolsCapabilities>;
}

interface ExecutionContextOptions {
  roomId: string;
  link: ExecutionContextLink;
  maxContextMessages: number;
}

export class ExecutionContext {
  public readonly roomId: string;
  public readonly link: ExecutionContextLink;
  private readonly maxContextMessages: number;
  private readonly history: PlatformMessage[] = [];
  private participants: ParticipantRecord[] = [];
  private readonly tools: AgentTools;
  private readonly adapterTools: AdapterToolsProtocol;
  private participantsMessage: string | null = null;
  private contactsMessage: string | null = null;
  private bootstrap = true;

  public constructor(options: ExecutionContextOptions) {
    this.roomId = options.roomId;
    this.link = options.link;
    this.maxContextMessages = options.maxContextMessages;
    this.tools = new AgentTools({
      roomId: this.roomId,
      rest: this.link.rest,
      participants: this.participants,
      capabilities: this.link.capabilities,
    });
    this.adapterTools = this.tools.getAdapterTools();
  }

  public getTools(): AdapterToolsProtocol {
    return this.adapterTools;
  }

  public recordMessage(message: PlatformMessage): void {
    this.history.push(message);
    if (this.history.length > this.maxContextMessages) {
      this.history.splice(0, this.history.length - this.maxContextMessages);
    }
  }

  public getRawHistory(): MetadataMap[] {
    return this.history.map((entry) => ({
      id: entry.id,
      room_id: entry.roomId,
      content: entry.content,
      sender_id: entry.senderId,
      sender_type: entry.senderType,
      sender_name: entry.senderName,
      message_type: entry.messageType,
      metadata: entry.metadata,
      created_at: entry.createdAt.toISOString(),
      role: entry.senderType === "User" ? "user" : "assistant",
    }));
  }

  public setParticipants(participants: ParticipantRecord[]): void {
    this.replaceParticipants(participants);
  }

  public addParticipant(participant: ParticipantRecord): void {
    const existingIndex = this.participants.findIndex((entry) => entry.id === participant.id);
    if (existingIndex >= 0) {
      this.participants.splice(existingIndex, 1);
    }
    this.participants.push(participant);
    const name = String(participant.name ?? "unknown");
    this.participantsMessage = `${name} joined the room.`;
  }

  public removeParticipant(participantId: string): void {
    const removed = this.participants.find((entry) => String(entry.id) === participantId);
    const next = this.participants.filter((entry) => String(entry.id) !== participantId);
    this.replaceParticipants(next);
    if (removed) {
      this.participantsMessage = `${String(removed.name ?? participantId)} left the room.`;
    }
  }

  public setContactsMessage(message: string | null): void {
    this.contactsMessage = message;
  }

  public consumeParticipantsMessage(): string | null {
    const value = this.participantsMessage;
    this.participantsMessage = null;
    return value;
  }

  public consumeContactsMessage(): string | null {
    const value = this.contactsMessage;
    this.contactsMessage = null;
    return value;
  }

  public consumeBootstrap(): boolean {
    const value = this.bootstrap;
    this.bootstrap = false;
    return value;
  }

  private replaceParticipants(participants: ParticipantRecord[]): void {
    this.participants.splice(0, this.participants.length, ...participants);
  }
}
