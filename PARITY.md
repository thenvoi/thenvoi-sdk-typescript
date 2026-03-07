# Python -> TypeScript Core Parity Report

Validated against `thenvoi-sdk-python` core modules (agent/platform/runtime/core).

## Implemented parity

- Agent lifecycle: `create`, `start`, `stop(timeout)`, `run`, `runForever`
- Runtime orchestration: metadata init before adapter start, room event loop, per-room execution
- Platform link: room/channel subscriptions, typed event dispatch, async iteration
- Tool constants and schema exports: `TOOL_MODELS`, `ALL_TOOL_NAMES`, `BASE_TOOL_NAMES`, `CHAT_TOOL_NAMES`, `CONTACT_TOOL_NAMES`, `MEMORY_TOOL_NAMES`, `MCP_TOOL_PREFIX`
- Runtime utilities: formatters, prompts, participant tracker, retry tracker, graceful shutdown helpers
- Adapter contracts: simple adapter + generic adapter + tool-calling adapter + OpenAI/Anthropic specializations
- SDK-backed tool-calling parity: `OpenAIAdapter` now defaults to official `openai` Chat Completions tool-calling and `AnthropicAdapter` now defaults to official `@anthropic-ai/sdk` Messages API tool-use/tool-result loops (with optional model override support)
- Additional TS-native provider adapter: `GeminiAdapter` using official `@google/genai` function-calling (`models.generateContent`) with Thenvoi tool loop bridging
- Framework adapter parity: `LangGraphAdapter` using official LangGraph JS (`createReactAgent`) and LangChain tool wrappers, with bootstrap system-prompt/history injection and tool start/end stream event forwarding
- Native SDK adapters: `ClaudeSDKAdapter` (stable Claude Agent SDK TypeScript API with Thenvoi MCP bridge and room-scoped session resume metadata) and `CodexAdapter` (Codex CLI app-server transport with room-scoped thread resume metadata, dynamic tool registration, typed custom tools, and local slash commands)
- Execution reporting parity: `ToolCallingAdapter` can emit `tool_call` and `tool_result` events for OpenAI/Anthropic/Gemini tool loops (`enableExecutionReporting`)
- A2A bridge adapter: `A2AAdapter` with session rehydration support from task-event metadata (`a2a_context_id`, `a2a_task_id`, `a2a_task_state`)
- A2A gateway adapter: `A2AGatewayAdapter` exposing Thenvoi peers as A2A endpoints (`@a2a-js/sdk/server` + Express middleware) with room/context correlation and streaming status events
- Parlant adapter: `ParlantAdapter` using official `parlant-client` sessions/customers/events API with Thenvoi room-session mapping and bootstrap history injection
- Socket/runtime parity improvements: `room_deleted` support and startup auto-subscribe of existing rooms (when available)
- Shared API ergonomics: paginated chat listing helper (`listAllChats`) and normalized pagination utilities
- Message/event typing parity: explicit chat event constants and runtime event-type validation
- External workflow integration helpers: Linear Agent Session bridge utilities with SQLite room mapping and final-response writeback

## Known non-parity (explicit and tested)

- Contacts/memory/peer endpoint execution is blocked by current Fern JS generated surface.
- SDK behavior intentionally raises `UnsupportedFeatureError` for those paths.

## Adapter integration readiness

- OpenAI/Anthropic adapters are SDK-backed by default and can still be overridden with a custom `ToolCallingModel`.
- Claude adapter calls the official SDK package directly. Codex uses the official CLI app-server protocol directly because the current `@openai/codex-sdk` TypeScript surface does not expose dynamic tool registration/custom app-server primitives. Both are covered by adapter contract tests.
- Tool schema generation and tool execution loop are stable and tested.
- `A2AAdapter` supports optional `@a2a-js/sdk` lazy loading and task resubscription on room bootstrap.
- `A2AGatewayAdapter` supports optional `@a2a-js/sdk/server` lazy loading and mounts peer-specific JSON-RPC + REST A2A routes.
- `ParlantAdapter` supports optional `parlant-client` lazy loading and room-scoped session persistence.

## Remaining parity gaps

- `CrewAIAdapter`: no clearly official/maintained CrewAI TypeScript SDK equivalent was validated.
- `PydanticAIAdapter`: no official PydanticAI TypeScript agent SDK package was validated.
