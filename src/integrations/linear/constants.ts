import type { SessionStatus, LinearSessionStatus } from "./types";

export const DEFAULT_STATUS_MAPPING: Record<SessionStatus, LinearSessionStatus> = {
  active: "active",
  canceled: "canceled",
  completed: "completed",
};
