/**
 * Global test setup for Vitest.
 */

import { vi, beforeEach, afterEach } from "vitest";

// Store original fetch
const originalFetch = globalThis.fetch;

// Reset the gateway registry directly via globalThis to avoid importing
// channel.ts before test-level vi.mock() calls have been hoisted.
// Must match the versioned key in channel.ts.
const PKG_VERSION = "0.1.4";
const GATEWAY_REGISTRY_KEY = `__thenvoi_gateway_registry_v${PKG_VERSION}__`;

beforeEach(() => {
  // Reset all mocks before each test
  vi.clearAllMocks();

  // Reset gateway registry to prevent state leaking between tests
  delete (globalThis as unknown as Record<string, unknown>)[GATEWAY_REGISTRY_KEY];

  // Reset environment variables
  delete process.env.THENVOI_API_KEY;
  delete process.env.THENVOI_AGENT_ID;
  delete process.env.THENVOI_WS_URL;
  delete process.env.THENVOI_REST_URL;
});

afterEach(() => {
  // Restore original fetch
  globalThis.fetch = originalFetch;
});
