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
}

export interface ContactRequestRecord extends MetadataMap {
  id?: string;
  handle?: string;
  status?: string;
  sent_status?: string;
}

export interface MemoryRecord extends MetadataMap {
  id?: string;
  memory_id?: string;
  content?: string;
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
