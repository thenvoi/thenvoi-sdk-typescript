import { describe, expect, it } from "vitest";

import * as adapters from "../src/adapters";
import * as sdk from "../src/index";
import * as linear from "../src/linear";
import * as mcp from "../src/mcp";
import * as rest from "../src/rest";
import * as testing from "../src/testing";

const expectedCoreExports = [
  "Agent",
  "ThenvoiLink",
  "PlatformRuntime",
  "AgentRuntime",
  "loadAgentConfig",
  "loadAgentConfigFromEnv",
  "DefaultPreprocessor",
  "isDirectExecution",
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
  "Execution",
  "ExecutionContext",
  "RoomPresence",
  "AgentTools",
  "CHAT_TOOL_NAMES",
  "CONTACT_TOOL_NAMES",
  "MEMORY_TOOL_NAMES",
  "ALL_TOOL_NAMES",
  "BASE_TOOL_NAMES",
  "mcpToolNames",
  "CHAT_EVENT_TYPES",
  "CHAT_MESSAGE_TYPES",
  "assertChatEventType",
  "isChatEventType",
  "formatMessageForLlm",
  "formatHistoryForLlm",
  "buildParticipantsMessage",
  "renderSystemPrompt",
  "ParticipantTracker",
  "MessageRetryTracker",
  "GracefulShutdown",
  "runWithGracefulShutdown",
  "FakeAgentTools",
  "FernRestAdapter",
  "RestFacade",
  "createLinearTools",
  "createSqliteSessionRoomStore",
  "handleAgentSessionEvent",
  "ConsoleLogger",
  "NoopLogger",
  "ValidationError",
  "UnsupportedFeatureError",
  "TransportError",
  "RuntimeStateError",
  "ThenvoiSdkError",
  "AdapterToolsProtocol",
  "AgentToolsProtocol",
  "FrameworkAdapter",
  "HistoryConverter",
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
    expect(rest).not.toHaveProperty("AgentRestAdapter");
    expect(linear).toHaveProperty("createLinearTools");
    expect(linear).toHaveProperty("handleAgentSessionEvent");
    expect(testing).toHaveProperty("FakeAgentTools");
    expect(adapters).toHaveProperty("GeminiToolCallingModel");
    expect(adapters).toHaveProperty("CodexAppServerStdioClient");
    expect(adapters).toHaveProperty("CodexJsonRpcError");
    expect(adapters).toHaveProperty("CODEX_REASONING_EFFORTS");
    expect(adapters).toHaveProperty("CODEX_WEB_SEARCH_MODES");
  });

  it("exposes MCP registration and server via mcp subpath", () => {
    expect(mcp).toHaveProperty("buildRoomScopedRegistrations");
    expect(mcp).toHaveProperty("buildSingleContextRegistrations");
    expect(mcp).toHaveProperty("ThenvoiMcpServer");
    expect(mcp).toHaveProperty("successResult");
    expect(mcp).toHaveProperty("errorResult");
  });
});
