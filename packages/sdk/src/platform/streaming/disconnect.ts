/** Structured information about a WebSocket disconnection. */
export interface DisconnectInfo {
  /** WebSocket close code, or `null` if unavailable. */
  code: number | null;
  /** Human-readable disconnect reason. */
  reason: string;
  /** Original server-provided reason string, or `null` if none was sent. */
  rawReason: string | null;
}

/** Callback invoked when the transport disconnects. */
export type DisconnectHandler = (info: DisconnectInfo) => void;

// ---------------------------------------------------------------------------
// Well-known WebSocket close codes (RFC 6455 + common extensions)
// ---------------------------------------------------------------------------

const WS_CLOSE_CODES: Record<number, string> = {
  1000: "Normal closure",
  1001: "Server going away",
  1002: "Protocol error",
  1003: "Unsupported data",
  1005: "No status received",
  1006: "Abnormal closure — no close frame received",
  1007: "Invalid payload data",
  1008: "Policy violation",
  1009: "Message too big",
  1010: "Missing extension",
  1011: "Internal server error",
  1012: "Service restart",
  1013: "Try again later",
  1015: "TLS handshake failure",
};

// ---------------------------------------------------------------------------
// Known server-provided reason strings (Phoenix / Thenvoi backend)
// These must stay in sync with the backend close-reason strings defined in
// the Thenvoi platform service.  Unknown reasons are displayed verbatim, so
// adding a new reason on the backend is non-breaking — entries here only
// provide friendlier messages.
// ---------------------------------------------------------------------------

const KNOWN_SERVER_REASONS: Record<string, string> = {
  duplicate_agent:
    "Another instance of this agent connected — only one connection per agent_id is allowed",
  stale_connection: "Connection was replaced by a newer one",
  agent_removed: "Agent was removed from the platform",
  unauthorized: "Connection rejected — invalid or expired credentials",
  rate_limited: "Connection closed due to rate limiting",
};

/**
 * Parse a WebSocket close code and/or server-provided reason into a
 * human-readable {@link DisconnectInfo}.
 *
 * Priority:
 * 1. Known server reason string (e.g. `"duplicate_agent"`)
 * 2. Unknown but non-empty server reason (included verbatim)
 * 3. Well-known WebSocket close code
 * 4. Numeric close code (fallback label)
 * 5. "Connection lost unexpectedly" when nothing is available
 */
export function parseDisconnectReason(
  code?: number | null,
  rawReason?: string | null,
): DisconnectInfo {
  const normalizedReason = rawReason?.trim() || null;

  // 1. Known server-provided reason
  if (normalizedReason) {
    const known = KNOWN_SERVER_REASONS[normalizedReason];
    if (known) {
      return { code: code ?? null, reason: known, rawReason: normalizedReason };
    }

    // 2. Unknown but non-empty server reason -- include it verbatim with
    //    an optional code prefix for additional context.
    const codeLabel = code != null ? WS_CLOSE_CODES[code] : null;
    const prefix = codeLabel ? `${codeLabel}: ` : "";
    return {
      code: code ?? null,
      reason: `${prefix}${normalizedReason}`,
      rawReason: normalizedReason,
    };
  }

  // 3. Well-known WebSocket close code
  if (code != null) {
    const codeLabel = WS_CLOSE_CODES[code];
    if (codeLabel) {
      return { code, reason: codeLabel, rawReason: null };
    }

    // 4. Numeric code only
    return { code, reason: `Connection closed with code ${code}`, rawReason: null };
  }

  // 5. Nothing at all
  return { code: null, reason: "Connection lost unexpectedly", rawReason: null };
}
