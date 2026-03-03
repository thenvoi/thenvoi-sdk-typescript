import { UnsupportedFeatureError } from "../../core/errors";
import { CHAT_EVENT_TYPES } from "../messages";

export const TOOL_MODELS = {
  thenvoi_send_message: {
    description: "Send a message to the chat room",
    properties: {
      content: { type: "string" },
      mentions: { type: "array", items: { type: "string" } },
    },
    required: ["content", "mentions"],
  },
  thenvoi_send_event: {
    description: "Send an event message",
    properties: {
      content: { type: "string" },
      message_type: { type: "string", enum: [...CHAT_EVENT_TYPES] },
      metadata: { type: "object" },
    },
    required: ["content", "message_type"],
  },
  thenvoi_add_participant: {
    description: "Add participant by name",
    properties: {
      name: { type: "string" },
      role: { type: "string" },
    },
    required: ["name"],
  },
  thenvoi_remove_participant: {
    description: "Remove participant by name",
    properties: {
      name: { type: "string" },
    },
    required: ["name"],
  },
  thenvoi_get_participants: {
    description: "List participants in room",
    properties: {},
    required: [],
  },
  thenvoi_lookup_peers: {
    description: "List available peers not in room",
    properties: {
      page: { type: "integer" },
      page_size: { type: "integer" },
    },
    required: [],
  },
  thenvoi_create_chatroom: {
    description: "Create new chat room",
    properties: {
      task_id: { type: "string" },
    },
    required: [],
  },
  thenvoi_list_contacts: {
    description: "List contacts",
    properties: {},
    required: [],
  },
  thenvoi_add_contact: {
    description: "Add contact",
    properties: {
      handle: { type: "string" },
      message: { type: "string" },
    },
    required: ["handle"],
  },
  thenvoi_remove_contact: {
    description: "Remove contact",
    properties: {
      handle: { type: "string" },
      contact_id: { type: "string" },
    },
    required: [],
  },
  thenvoi_list_contact_requests: {
    description: "List contact requests",
    properties: {},
    required: [],
  },
  thenvoi_respond_contact_request: {
    description: "Respond to contact request",
    properties: {
      action: { type: "string" },
      handle: { type: "string" },
      request_id: { type: "string" },
    },
    required: ["action"],
  },
  thenvoi_list_memories: {
    description: "List memories",
    properties: {},
    required: [],
  },
  thenvoi_store_memory: {
    description: "Store memory",
    properties: {
      content: { type: "string" },
      system: { type: "string" },
      type: { type: "string" },
      segment: { type: "string" },
      thought: { type: "string" },
    },
    required: ["content", "system", "type", "segment", "thought"],
  },
  thenvoi_get_memory: {
    description: "Get memory",
    properties: {
      memory_id: { type: "string" },
    },
    required: ["memory_id"],
  },
  thenvoi_supersede_memory: {
    description: "Supersede memory",
    properties: {
      memory_id: { type: "string" },
    },
    required: ["memory_id"],
  },
  thenvoi_archive_memory: {
    description: "Archive memory",
    properties: {
      memory_id: { type: "string" },
    },
    required: ["memory_id"],
  },
} as const;

export const ALL_TOOL_NAMES = new Set(Object.keys(TOOL_MODELS));

export const MEMORY_TOOL_NAMES = new Set<string>([
  "thenvoi_list_memories",
  "thenvoi_store_memory",
  "thenvoi_get_memory",
  "thenvoi_supersede_memory",
  "thenvoi_archive_memory",
]);

export const CONTACT_TOOL_NAMES = new Set<string>([
  "thenvoi_list_contacts",
  "thenvoi_add_contact",
  "thenvoi_remove_contact",
  "thenvoi_list_contact_requests",
  "thenvoi_respond_contact_request",
]);

export const BASE_TOOL_NAMES = new Set<string>(
  [...ALL_TOOL_NAMES].filter((name) => !MEMORY_TOOL_NAMES.has(name)),
);

export const CHAT_TOOL_NAMES = new Set<string>(
  [...BASE_TOOL_NAMES].filter((name) => !CONTACT_TOOL_NAMES.has(name)),
);

export const MCP_TOOL_PREFIX = "mcp__thenvoi__";

export function mcpToolNames(names: Set<string>): string[] {
  return [...names].sort((a, b) => a.localeCompare(b)).map((name) => `${MCP_TOOL_PREFIX}${name}`);
}

export function getToolDescription(name: string): string {
  const model = TOOL_MODELS[name as keyof typeof TOOL_MODELS];
  return model?.description ?? `Execute ${name}`;
}

export function assertFeatureEnabled(enabled: boolean, feature: string): void {
  if (!enabled) {
    throw new UnsupportedFeatureError(
      `${feature} is not available with the current fern-javascript-sdk snapshot`,
    );
  }
}
