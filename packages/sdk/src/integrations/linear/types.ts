import type { LinearClient } from "@linear/sdk";
import type { AgentSessionEventWebhookPayload } from "@linear/sdk/webhooks";

import type { RestApi } from "../../client/rest/types";
import type { Logger } from "../../core/logger";

export type RoomStrategy = "issue" | "session";
export type WritebackMode = "final_only" | "activity_stream";
export type SessionStatus = "active" | "waiting" | "completed" | "canceled" | "errored";

export interface LinearThenvoiBridgeConfig {
  linearAccessToken: string;
  linearWebhookSecret: string;
  roomStrategy?: RoomStrategy;
  writebackMode?: WritebackMode;
  hostAgentHandle?: string;
  planningAgentHandles?: string[];
  implementationAgentHandles?: string[];
  recoveredRoomRetryBaseDelayMs?: number;
  thenvoiAppBaseUrl?: string;
}

export interface SessionRoomRecord {
  linearSessionId: string;
  linearIssueId: string | null;
  thenvoiRoomId: string;
  status: SessionStatus;
  lastEventKey?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PendingBootstrapRequest {
  eventKey: string;
  linearSessionId: string;
  thenvoiRoomId: string;
  expectedContent: string;
  messageType: string;
  senderId?: string | null;
  senderName?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
}

export interface SessionRoomStore {
  getBySessionId(sessionId: string): Promise<SessionRoomRecord | null>;
  getByIssueId(issueId: string): Promise<SessionRoomRecord | null>;
  upsert(record: SessionRoomRecord): Promise<void>;
  markCanceled(sessionId: string): Promise<void>;
  enqueueBootstrapRequest(request: PendingBootstrapRequest): Promise<void>;
  listPendingBootstrapRequests(limit?: number): Promise<PendingBootstrapRequest[]>;
  markBootstrapRequestProcessed(eventKey: string): Promise<void>;
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

export type { LinearActivityClient, PlanStep } from "./activities";

export type LinearSessionStatus =
  SessionStatus;
