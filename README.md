# Thenvoi SDK TypeScript

TypeScript SDK with Python-core parity for Thenvoi external agents.

## Current parity status

Implemented and validated for adapter integration:

- Composition runtime: `Agent`, `PlatformRuntime`, `AgentRuntime`, `ExecutionContext`
- Platform link: `ThenvoiLink` (Phoenix channels + REST facade)
- Message lifecycle: `markProcessing`, `markProcessed`, `markFailed`
- Tooling contract: `AgentTools`, tool schema constants, OpenAI/Anthropic schema output
- Chat event type model: `CHAT_EVENT_TYPES`, `CHAT_MESSAGE_TYPES`, event type guards
- Adapter contracts: `FrameworkAdapter`, `SimpleAdapter`, `GenericAdapter`
- Tool-calling adapters: `ToolCallingAdapter`, `OpenAIAdapter`, `AnthropicAdapter`
- Framework integration adapters: `LangGraphAdapter` (official `@langchain/langgraph` + `@langchain/core` integration with tool wrappers, event forwarding, and bootstrap history handling)
- Native SDK adapters: `OpenAIAdapter` (`openai`, optional), `AnthropicAdapter` (`@anthropic-ai/sdk`, optional), `GeminiAdapter` (`@google/genai`, optional), `ClaudeSDKAdapter` (stable Claude Agent SDK TypeScript API with Thenvoi MCP bridge + room-scoped resume markers), `CodexAdapter` (`@openai/codex-sdk` with history-based thread resume + local slash commands), `A2AAdapter` (`@a2a-js/sdk`, optional), `A2AGatewayAdapter` (`@a2a-js/sdk/server`, optional), `ParlantAdapter` (`parlant-client`, optional)
- Execution telemetry: `ToolCallingAdapter` supports optional `tool_call` / `tool_result` event reporting (`enableExecutionReporting`)
- Integration helpers: Linear Agent Session bridge utilities (`handleAgentSessionEvent`, SQLite session-room mapping store, final-response writeback helper)
- Runtime utilities: formatters, prompts, participant tracker, retry tracker, graceful shutdown
- Room lifecycle hardening: handles `room_deleted` events and can auto-subscribe existing rooms on startup
- Pagination utilities: `fetchPaginated` + REST `listAllChats` aggregation helpers
- End-to-end examples: Linear + Thenvoi bridge server and Thenvoi-hosted orchestrator agent examples

Known gap (explicitly gated):

- Contacts/memory/peer REST endpoints are not fully available in the current Fern JS snapshot.
- `listPeers` / `listChats` are adapter-availability dependent at the REST contract boundary.
- Adapter-facing tool surfaces are capability-scoped: privileged methods are only exposed when enabled.
- SDK behavior is explicit: unsupported privileged calls throw `UnsupportedFeatureError`.

## Why this is adapter-ready

- Stable 1:1-style execution contract (`onStarted` -> `onEvent` -> `onCleanup`)
- Deterministic room-scoped context and tool bindings
- Provider-neutral tool schemas for immediate adapter implementation
- Conformance tests for surface parity and known-gap behavior

## Install

```bash
pnpm install
```

## Validate

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Example folders

Each example lives in its own folder so you can copy that folder out and iterate on it.

- `examples/basic/`
- `examples/openai/`
- `examples/anthropic/`
- `examples/gemini/`
- `examples/claude-sdk/`
- `examples/codex/`
- `examples/custom-adapter/`
- `examples/langgraph/`
- `examples/parlant/`
- `examples/a2a-bridge/`
- `examples/a2a-gateway/`
- `examples/linear-thenvoi/`

## Next adapter integration steps

1. Add CI-gated integration tests against live provider SDKs (`openai`, `@anthropic-ai/sdk`, `@google/genai`, `@openai/codex-sdk`, `@anthropic-ai/claude-agent-sdk`) for tool round-trips.
2. Continue parity expansion only where official JS/TS SDKs exist and are maintained.
3. Keep `CrewAIAdapter` / `PydanticAIAdapter` as explicit parity gaps until official JS SDK support is clear.
