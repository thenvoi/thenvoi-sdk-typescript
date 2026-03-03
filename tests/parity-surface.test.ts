import { describe, expect, it } from "vitest";

import * as sdk from "../src/index";

const expectedCoreExports = [
  "Agent",
  "ThenvoiLink",
  "PlatformRuntime",
  "AgentRuntime",
  "ExecutionContext",
  "AgentTools",
  "TOOL_MODELS",
  "CHAT_EVENT_TYPES",
  "MCP_TOOL_PREFIX",
  "CHAT_TOOL_NAMES",
  "MEMORY_TOOL_NAMES",
  "mcpToolNames",
  "formatMessageForLlm",
  "formatHistoryForLlm",
  "buildParticipantsMessage",
  "ParticipantTracker",
  "MessageRetryTracker",
  "GracefulShutdown",
  "runWithGracefulShutdown",
  "renderSystemPrompt",
  "DefaultPreprocessor",
  "GenericAdapter",
  "OpenAIAdapter",
  "AnthropicAdapter",
  "GeminiAdapter",
  "LangGraphAdapter",
  "A2AAdapter",
  "A2AGatewayAdapter",
  "ParlantAdapter",
  "ClaudeSDKAdapter",
  "CodexAdapter",
  "SimpleAdapter",
  "RestFacade",
  "FernRestAdapter",
];

describe("sdk parity surface", () => {
  it("exports core runtime symbols needed for adapter integrations", () => {
    for (const symbol of expectedCoreExports) {
      expect(sdk).toHaveProperty(symbol);
    }
  });

  it("preserves python tool naming constants", () => {
    expect(sdk.MCP_TOOL_PREFIX).toBe("mcp__thenvoi__");
    expect(sdk.TOOL_MODELS).toHaveProperty("thenvoi_send_message");
    expect(sdk.TOOL_MODELS).toHaveProperty("thenvoi_lookup_peers");
    expect(sdk.TOOL_MODELS).toHaveProperty("thenvoi_list_memories");
  });
});
