import { describe, expect, it } from "vitest";

import * as sdk from "../src/index";

const parityMap: Record<string, string> = {
  Agent: "Agent",
  ThenvoiLink: "ThenvoiLink",
  PlatformRuntime: "PlatformRuntime",
  AgentRuntime: "AgentRuntime",
  ExecutionContext: "ExecutionContext",
  AgentTools: "AgentTools",
  TOOL_MODELS: "TOOL_MODELS",
  ALL_TOOL_NAMES: "ALL_TOOL_NAMES",
  BASE_TOOL_NAMES: "BASE_TOOL_NAMES",
  CHAT_TOOL_NAMES: "CHAT_TOOL_NAMES",
  CONTACT_TOOL_NAMES: "CONTACT_TOOL_NAMES",
  MEMORY_TOOL_NAMES: "MEMORY_TOOL_NAMES",
  MCP_TOOL_PREFIX: "MCP_TOOL_PREFIX",
  mcp_tool_names: "mcpToolNames",
  format_message_for_llm: "formatMessageForLlm",
  format_history_for_llm: "formatHistoryForLlm",
  build_participants_message: "buildParticipantsMessage",
  render_system_prompt: "renderSystemPrompt",
  ParticipantTracker: "ParticipantTracker",
  MessageRetryTracker: "MessageRetryTracker",
  GracefulShutdown: "GracefulShutdown",
  run_with_graceful_shutdown: "runWithGracefulShutdown",
  ClaudeSDKAdapter: "ClaudeSDKAdapter",
  CodexAdapter: "CodexAdapter",
  LangGraphAdapter: "LangGraphAdapter",
  AnthropicAdapter: "AnthropicAdapter",
  A2AAdapter: "A2AAdapter",
  A2AGatewayAdapter: "A2AGatewayAdapter",
  ParlantAdapter: "ParlantAdapter",
};

describe("python parity symbol mapping", () => {
  it("keeps python core symbols represented in typescript exports", () => {
    for (const [pythonSymbol, tsSymbol] of Object.entries(parityMap)) {
      expect(sdk, `Missing mapping for ${pythonSymbol} -> ${tsSymbol}`).toHaveProperty(tsSymbol);
    }
  });
});
