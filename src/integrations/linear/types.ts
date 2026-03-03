import type { LinearClient } from "@linear/sdk";
import type { AgentSessionEventWebhookPayload } from "@linear/sdk/webhooks";

import type { RestApi } from "../../client/rest/types";
import type { Logger } from "../../core/logger";

export type RoomStrategy = "issue" | "session";
export type WritebackMode = "final_only";
export type SessionStatus = "active" | "canceled" | "completed";

export interface LinearThenvoiBridgeConfig {
  linearAccessToken: string;
  linearWebhookSecret: string;
  roomStrategy?: RoomStrategy;
  writebackMode?: WritebackMode;
  hostAgentHandle: string;
  defaultSpecialistHandles?: string[];
}

export interface SessionRoomRecord {
  linearSessionId: string;
  linearIssueId: string | null;
  thenvoiRoomId: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRoomStore {
  getBySessionId(sessionId: string): Promise<SessionRoomRecord | null>;
  getByIssueId(issueId: string): Promise<SessionRoomRecord | null>;
  upsert(record: SessionRoomRecord): Promise<void>;
  markCanceled(sessionId: string): Promise<void>;
  close?(): Promise<void>;
}

export interface LinearThenvoiBridgeDeps {
  thenvoiRest: RestApi;
  linearClient: LinearClient;
  store: SessionRoomStore;
  logger?: Logger;
}

export interface HandleAgentSessionEventInput {
  payload: AgentSessionEventWebhookPayload;
  config: LinearThenvoiBridgeConfig;
  deps: LinearThenvoiBridgeDeps;
}
