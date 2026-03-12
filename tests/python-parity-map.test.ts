import { describe, expect, it } from "vitest";

import * as sdk from "../src/index";
import * as runtime from "../src/runtime";

const parityMap: Array<{
  canonicalName: string;
  module: Record<string, unknown>;
  symbol: string;
}> = [
  { canonicalName: "Agent", module: sdk, symbol: "Agent" },
  { canonicalName: "ThenvoiLink", module: sdk, symbol: "ThenvoiLink" },
  { canonicalName: "PlatformRuntime", module: sdk, symbol: "PlatformRuntime" },
  { canonicalName: "AgentRuntime", module: sdk, symbol: "AgentRuntime" },
  { canonicalName: "ExecutionContext", module: runtime, symbol: "ExecutionContext" },
  { canonicalName: "AgentTools", module: runtime, symbol: "AgentTools" },
  { canonicalName: "TOOL_MODELS", module: sdk, symbol: "TOOL_MODELS" },
  { canonicalName: "ALL_TOOL_NAMES", module: runtime, symbol: "ALL_TOOL_NAMES" },
  { canonicalName: "BASE_TOOL_NAMES", module: runtime, symbol: "BASE_TOOL_NAMES" },
  { canonicalName: "CHAT_TOOL_NAMES", module: runtime, symbol: "CHAT_TOOL_NAMES" },
  { canonicalName: "CONTACT_TOOL_NAMES", module: runtime, symbol: "CONTACT_TOOL_NAMES" },
  { canonicalName: "MEMORY_TOOL_NAMES", module: runtime, symbol: "MEMORY_TOOL_NAMES" },
  { canonicalName: "MCP_TOOL_PREFIX", module: sdk, symbol: "MCP_TOOL_PREFIX" },
  { canonicalName: "mcp_tool_names", module: runtime, symbol: "mcpToolNames" },
  { canonicalName: "format_message_for_llm", module: runtime, symbol: "formatMessageForLlm" },
  { canonicalName: "format_history_for_llm", module: runtime, symbol: "formatHistoryForLlm" },
  { canonicalName: "build_participants_message", module: runtime, symbol: "buildParticipantsMessage" },
  { canonicalName: "render_system_prompt", module: runtime, symbol: "renderSystemPrompt" },
  { canonicalName: "ParticipantTracker", module: runtime, symbol: "ParticipantTracker" },
  { canonicalName: "MessageRetryTracker", module: runtime, symbol: "MessageRetryTracker" },
  { canonicalName: "GracefulShutdown", module: runtime, symbol: "GracefulShutdown" },
  { canonicalName: "run_with_graceful_shutdown", module: runtime, symbol: "runWithGracefulShutdown" },
  { canonicalName: "ClaudeSDKAdapter", module: sdk, symbol: "ClaudeSDKAdapter" },
  { canonicalName: "CodexAdapter", module: sdk, symbol: "CodexAdapter" },
  { canonicalName: "LangGraphAdapter", module: sdk, symbol: "LangGraphAdapter" },
  { canonicalName: "AnthropicAdapter", module: sdk, symbol: "AnthropicAdapter" },
  { canonicalName: "A2AAdapter", module: sdk, symbol: "A2AAdapter" },
  { canonicalName: "A2AGatewayAdapter", module: sdk, symbol: "A2AGatewayAdapter" },
  { canonicalName: "ParlantAdapter", module: sdk, symbol: "ParlantAdapter" },
];

describe("cross-sdk symbol mapping", () => {
  it("exports all expected symbols", () => {
    for (const entry of parityMap) {
      expect(entry.module, `Missing mapping for ${entry.canonicalName} -> ${entry.symbol}`).toHaveProperty(entry.symbol);
    }
  });
});
