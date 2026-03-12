export interface MetadataMap {
  [key: string]: unknown;
}

export interface ToolOperationResult {
  ok?: boolean;
  status?: string;
  [key: string]: unknown;
}

export interface MentionReference {
  id: string;
  handle?: string;
  name?: string;
  username?: string;
}

export type MentionInput = string[] | MentionReference[];

export interface PaginationMetadataLike {
  page?: number;
  pageSize?: number;
  totalPages?: number;
  totalCount?: number;
  [key: string]: unknown;
}

export interface PaginatedList<TItem = MetadataMap> {
  data: TItem[];
  metadata?: PaginationMetadataLike;
}

export interface ParticipantRecord {
  id: string;
  name: string;
  type: string;
  handle?: string | null;
  role?: string;
}

export interface PeerRecord {
  id?: string;
  name?: string;
  type?: string;
  handle?: string | null;
  description?: string | null;
}

export interface ContactRecord {
  id?: string;
  handle?: string;
  name?: string | null;
  type?: string;
  description?: string | null;
  is_external?: boolean | null;
  inserted_at?: string;
}

export interface ContactRequestRecord {
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

export interface ContactRequestsResult {
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

export interface ListMemoriesArgs {
  subject_id?: string;
  scope?: MemoryScope;
  system?: MemorySystem;
  type?: MemoryType;
  segment?: MemorySegment;
  content_query?: string;
  page_size?: number;
  status?: MemoryStatus;
}

export interface StoreMemoryArgs {
  content: string;
  system: MemorySystem;
  type: MemoryType;
  segment: MemorySegment;
  thought: string;
  scope?: MemoryVisibility;
  subject_id?: string;
  metadata?: MetadataMap;
}

export interface MemoryRecord {
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

/** Tool schema as returned by getToolSchemas(). Format depends on the requested format ("openai" or "anthropic"). */
export interface ToolSchemaRecord {
  [key: string]: unknown;
}

export type ToolMessageRole = "system" | "user" | "assistant";

export interface ToolModelMessage {
  role: ToolMessageRole;
  content: unknown;
  sender_name?: string | null;
  sender_type?: string;
  message_type?: string;
  metadata?: MetadataMap;
  [key: string]: unknown;
}

export interface ToolModelSchema {
  [key: string]: unknown;
}
