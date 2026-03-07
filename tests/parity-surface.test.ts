import { describe, expect, it } from "vitest";

import * as adapters from "../src/adapters";
import * as sdk from "../src/index";
import * as linear from "../src/linear";
import * as rest from "../src/rest";
import * as testing from "../src/testing";

const expectedCoreExports = [
  "Agent",
  "ThenvoiLink",
  "PlatformRuntime",
  "AgentRuntime",
  "ExecutionContext",
  "AgentTools",
  "loadAgentConfig",
  "loadAgentConfigFromEnv",
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
  "CODEX_REASONING_EFFORTS",
  "CODEX_REASONING_SUMMARIES",
  "CODEX_WEB_SEARCH_MODES",
  "SimpleAdapter",
];

const movedToSubpaths = [
  "AgentRestAdapter",
  "FakeAgentTools",
  "FernRestAdapter",
  "RestFacade",
  "createLinearTools",
  "createSqliteSessionRoomStore",
  "handleAgentSessionEvent",
];

describe("sdk public surface", () => {
  it("exports core runtime symbols needed for adapter integrations", () => {
    for (const symbol of expectedCoreExports) {
      expect(sdk).toHaveProperty(symbol);
    }
  });

  it("preserves tool naming constants", () => {
    expect(sdk.MCP_TOOL_PREFIX).toBe("mcp__thenvoi__");
    expect(sdk.TOOL_MODELS).toHaveProperty("thenvoi_send_message");
    expect(sdk.TOOL_MODELS).toHaveProperty("thenvoi_lookup_peers");
    expect(sdk.TOOL_MODELS).toHaveProperty("thenvoi_list_memories");
  });

  it("keeps advanced helper modules off the root barrel", () => {
    for (const symbol of movedToSubpaths) {
      expect(sdk).not.toHaveProperty(symbol);
    }
  });

  it("exposes advanced helper modules via subpaths", () => {
    expect(rest).toHaveProperty("RestFacade");
    expect(rest).toHaveProperty("FernRestAdapter");
    expect(rest).toHaveProperty("AgentRestAdapter");
    expect(linear).toHaveProperty("createLinearTools");
    expect(linear).toHaveProperty("handleAgentSessionEvent");
    expect(testing).toHaveProperty("FakeAgentTools");
    expect(adapters).toHaveProperty("GeminiToolCallingModel");
    expect(adapters).toHaveProperty("CodexAppServerStdioClient");
    expect(adapters).toHaveProperty("CodexJsonRpcError");
    expect(adapters).toHaveProperty("CODEX_REASONING_EFFORTS");
    expect(adapters).toHaveProperty("CODEX_WEB_SEARCH_MODES");
  });
});
