export interface MetadataMap {
  [key: string]: unknown;
}

export interface ToolOperationResult extends MetadataMap {
  ok?: boolean;
  status?: string;
}

export interface MentionReference {
  id: string;
  handle?: string;
  username?: string;
}

export type MentionInput = string[] | MentionReference[];

export interface PaginationMetadataLike extends MetadataMap {
  page?: number;
  pageSize?: number;
  totalPages?: number;
  totalCount?: number;
}

export interface PaginatedList<TItem extends MetadataMap = MetadataMap> {
  data: TItem[];
  metadata?: PaginationMetadataLike;
}

export interface ParticipantRecord extends MetadataMap {
  id: string;
  name: string;
  type: string;
  handle?: string | null;
  role?: string;
}

export interface PeerRecord extends MetadataMap {
  id?: string;
  name?: string;
  type?: string;
  handle?: string | null;
}

export interface ContactRecord extends MetadataMap {
  id?: string;
  handle?: string;
  name?: string | null;
  type?: string;
  description?: string | null;
  is_external?: boolean | null;
  inserted_at?: string;
}

export interface ContactRequestRecord extends MetadataMap {
  id?: string;
  status?: string;
  message?: string | null;
  inserted_at?: string | null;
}

export interface ReceivedContactRequestRecord extends ContactRequestRecord {
  from_handle?: string | null;
  from_name?: string | null;
}

export interface SentContactRequestRecord extends ContactRequestRecord {
  to_handle?: string | null;
  to_name?: string | null;
}

export interface ContactRequestsResult extends MetadataMap {
  received: ReceivedContactRequestRecord[];
  sent: SentContactRequestRecord[];
  metadata?: MetadataMap;
}

export type ContactRequestAction = "approve" | "reject" | "cancel";

export type MemoryScope = "subject" | "organization" | "all";
export type MemoryVisibility = Exclude<MemoryScope, "all">;
export type MemorySystem = "sensory" | "working" | "long_term";
export type MemoryType =
  | "iconic"
  | "echoic"
  | "haptic"
  | "episodic"
  | "semantic"
  | "procedural";
export type MemorySegment = "user" | "agent" | "tool" | "guideline";
export type MemoryStatus = "active" | "superseded" | "archived" | "all";

export interface ListMemoriesArgs extends MetadataMap {
  subject_id?: string;
  scope?: MemoryScope;
  system?: MemorySystem;
  type?: MemoryType;
  segment?: MemorySegment;
  content_query?: string;
  page_size?: number;
  status?: MemoryStatus;
}

export interface StoreMemoryArgs extends MetadataMap {
  content: string;
  system: MemorySystem;
  type: MemoryType;
  segment: MemorySegment;
  thought: string;
  scope?: MemoryVisibility;
  subject_id?: string;
  metadata?: MetadataMap;
}

export interface MemoryRecord extends MetadataMap {
  id?: string;
  content?: string;
  system?: string;
  type?: string;
  segment?: string;
  thought?: string | null;
  subject_id?: string | null;
  source_agent_id?: string | null;
  organization_id?: string | null;
  scope?: string;
  status?: string;
  metadata?: MetadataMap | null;
  inserted_at?: string | null;
}

export interface ToolSchemaRecord extends MetadataMap {}

export type ToolMessageRole = "system" | "user" | "assistant";

export interface ToolModelMessage extends MetadataMap {
  role: ToolMessageRole;
  content: unknown;
  sender_name?: string | null;
  sender_type?: string;
  message_type?: string;
  metadata?: MetadataMap;
}

export interface ToolModelSchema extends MetadataMap {}
