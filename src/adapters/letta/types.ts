import { ParlantHistoryConverter } from "../parlant/types";
import type { ParlantMessage } from "../parlant/types";

/**
 * Letta history shares the same shape as Parlant history.
 * Re-export under Letta-specific names for API clarity.
 */
export type LettaMessage = ParlantMessage;
export type LettaMessages = LettaMessage[];
export const LettaHistoryConverter = ParlantHistoryConverter;
