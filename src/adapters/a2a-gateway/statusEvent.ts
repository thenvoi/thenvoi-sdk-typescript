import { randomUUID } from "node:crypto";

import type { GatewayA2AStatusUpdateEvent, GatewayTaskState } from "./types";

interface BuildStatusEventInput {
  taskId: string;
  contextId: string;
  state: GatewayTaskState;
  final: boolean;
  text: string;
  metadata?: Record<string, unknown>;
}

export function buildStatusEvent(input: BuildStatusEventInput): GatewayA2AStatusUpdateEvent {
  return {
    kind: "status-update",
    taskId: input.taskId,
    contextId: input.contextId,
    final: input.final,
    status: {
      state: input.state,
      timestamp: new Date().toISOString(),
      message: {
        kind: "message",
        messageId: randomUUID(),
        role: "agent",
        taskId: input.taskId,
        contextId: input.contextId,
        parts: input.text
          ? [
              {
                kind: "text",
                text: input.text,
              },
            ]
          : [],
      },
    },
    metadata: input.metadata,
  };
}
