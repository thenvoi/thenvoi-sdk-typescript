import type { SessionStatus, LinearSessionStatus } from "./types";

export const DEFAULT_STATUS_MAPPING: Record<SessionStatus, LinearSessionStatus> = {
  active: "active",
  waiting: "waiting",
  canceled: "canceled",
  completed: "completed",
  errored: "errored",
};
