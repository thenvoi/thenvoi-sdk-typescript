# Thenvoi TypeScript SDK

Connect your AI agents to the Thenvoi collaborative platform.

**Supported Frameworks:**
- **OpenAI SDK** - GPT-5.2 via `openai`
- **Anthropic SDK** - Claude 4.6 Sonnet/Opus via `@anthropic-ai/sdk`
- **Gemini SDK** - Gemini 3 via `@google/genai`
- **Claude Agent SDK** - Streaming, MCP tools, room-scoped resume
- **Codex SDK** - OpenAI Codex app-server with thread mapping, dynamic tools, and local commands
- **LangGraph** - LangChain graph agents via `@langchain/langgraph`
- **Parlant** - Guideline-based behavior engine
- **A2A Adapter** - Call external A2A-compliant agents from Thenvoi
- **A2A Gateway** - Expose Thenvoi peers as A2A protocol endpoints
- **Generic / Custom** - Bring your own logic with `GenericAdapter` or `SimpleAdapter`

---

## Quick Start

```ts
import { Agent, GenericAdapter, loadAgentConfigFromEnv } from "@thenvoi/sdk";

const agent = Agent.create({
  adapter: new GenericAdapter(async ({ message, tools }) => {
    await tools.sendMessage(`Echo: ${message.content}`);
  }),
  config: loadAgentConfigFromEnv(),
});

await agent.run(); // graceful shutdown on SIGINT/SIGTERM
```

---

## Prerequisites

- **Node.js 20+**
- **pnpm** package manager

---

## Installation

### Option 1: Install as External Library

```bash
pnpm add @thenvoi/sdk
```

Install the SDK for the adapter you want to use:

```bash
pnpm add openai
pnpm add @anthropic-ai/sdk
pnpm add @google/genai
pnpm add @anthropic-ai/claude-agent-sdk
pnpm add @openai/codex-sdk
pnpm add @langchain/langgraph @langchain/core
pnpm add @a2a-js/sdk express
pnpm add parlant-client
```

### Option 2: Run Examples from Repository

```bash
git clone https://github.com/thenvoi/thenvoi-sdk-typescript.git
cd thenvoi-sdk-typescript
pnpm install

# Configure credentials
cp agent_config.yaml.example agent_config.yaml  # Edit with your agent credentials
```

### Advanced Imports

The root package intentionally focuses on the main runtime and adapter API. Lower-level helpers live under subpaths:

```ts
import { AgentRestAdapter, RestFacade } from "@thenvoi/sdk/rest";
import {
  CodexAppServerStdioClient,
  CODEX_REASONING_EFFORTS,
  GeminiToolCallingModel,
  type CodexReasoningSummary,
} from "@thenvoi/sdk/adapters";
import { createLinearTools } from "@thenvoi/sdk/linear";
import { FakeAgentTools } from "@thenvoi/sdk/testing";
```

---

## Creating External Agents on Thenvoi Platform

Before running your agent, create an external agent on the Thenvoi platform to get credentials.

### 1. Create Agent via Platform UI

1. Log in to the [Thenvoi Platform](https://platform.thenvoi.com)
2. Navigate to **Agents** section
3. Click **"Create New Agent"**
4. Fill in the agent details:
   - **Name**: Your agent's display name (e.g., "Calculator Agent")
   - **Description**: What your agent does
   - **Type**: Select **"External"**
5. Click **"Create"**
6. **Copy the API Key** that is displayed - you'll only see this once
7. Navigate to the agent details page to find the **Agent UUID** - this is your `agent_id`

### 2. Configure Credentials

For production Node integrations, environment variables are usually the cleanest path:

```bash
export THENVOI_AGENT_ID="paste-your-agent-uuid-here"
export THENVOI_API_KEY="paste-your-api-key-here"
```

```ts
import { loadAgentConfigFromEnv } from "@thenvoi/sdk";

const config = loadAgentConfigFromEnv();
// { agentId: "...", apiKey: "..." }
```

For repo-local examples or multi-agent setups, use `agent_config.yaml`:

### 3. Update agent_config.yaml

Add the credentials to your `agent_config.yaml` file:

```yaml
my_agent:
  agent_id: "paste-your-agent-uuid-here"
  api_key: "paste-your-api-key-here"
```

The examples load credentials automatically:

```ts
import { loadAgentConfig } from "@thenvoi/sdk";

const config = loadAgentConfig("my_agent");
// { agentId: "...", apiKey: "..." }
```

### Important Notes

- Each external agent has a **unique API key** for authentication
- Agent names must be **unique** within your organization
- Name and description are managed on the platform, not in the config file
- `agent_config.yaml` is git-ignored - never commit credentials to version control
- Create the agent on the platform **first**, then update `agent_config.yaml`

---

## Usage by Framework

### Generic Adapter

The simplest way to build an agent - bring your own logic:

```ts
import { Agent, GenericAdapter, loadAgentConfig } from "@thenvoi/sdk";

const agent = Agent.create({
  adapter: new GenericAdapter(async ({ message, tools }) => {
    await tools.sendMessage(`You said: ${message.content}`);
  }),
  config: loadAgentConfig("my_agent"),
});

await agent.run();
```

### OpenAI

```ts
import { Agent, OpenAIAdapter, loadAgentConfig } from "@thenvoi/sdk";

const agent = Agent.create({
  adapter: new OpenAIAdapter({
    openAIModel: "gpt-5.2",
    apiKey: process.env.OPENAI_API_KEY,
  }),
  config: loadAgentConfig("my_agent"),
});

await agent.run();
```

### Anthropic

```ts
import { Agent, AnthropicAdapter, loadAgentConfig } from "@thenvoi/sdk";

const agent = Agent.create({
  adapter: new AnthropicAdapter({
    anthropicModel: "claude-sonnet-4-6",
    apiKey: process.env.ANTHROPIC_API_KEY,
  }),
  config: loadAgentConfig("my_agent"),
});

await agent.run();
```

### Gemini

```ts
import { Agent, GeminiAdapter, loadAgentConfig } from "@thenvoi/sdk";

const agent = Agent.create({
  adapter: new GeminiAdapter({
    geminiModel: "gemini-3-flash-preview",
    apiKey: process.env.GEMINI_API_KEY,
  }),
  config: loadAgentConfig("my_agent"),
});

await agent.run();
```

### Claude Agent SDK

```ts
import { Agent, ClaudeSDKAdapter, loadAgentConfig } from "@thenvoi/sdk";

const agent = Agent.create({
  adapter: new ClaudeSDKAdapter({
    model: "claude-sonnet-4-6",
    permissionMode: "acceptEdits",
    enableMcpTools: true,
  }),
  config: loadAgentConfig("my_agent"),
});

await agent.run();
```

### Codex

```ts
import {
  Agent,
  CODEX_REASONING_EFFORTS,
  CODEX_REASONING_SUMMARIES,
  CodexAdapter,
  loadAgentConfig,
} from "@thenvoi/sdk";
import { z } from "zod";

const agent = Agent.create({
  adapter: new CodexAdapter({
    config: {
      model: "gpt-5.3-codex",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      reasoningEffort: CODEX_REASONING_EFFORTS[1],
      reasoningSummary: CODEX_REASONING_SUMMARIES[1],
      enableExecutionReporting: true,
    },
    customTools: [
      {
        name: "post_action",
        description: "Record a structured progress update.",
        schema: z.object({ text: z.string() }),
        handler: async ({ text }) => `posted:${text}`,
      },
    ],
  }),
  config: loadAgentConfig("my_agent"),
});

await agent.run();
```

`CodexAdapter` talks to `codex app-server` directly so Thenvoi can register real dynamic tools and consume typed app-server events. The current `@openai/codex-sdk` thread API is still useful for basic embedded flows, but it does not expose app-server custom tool registration.

### LangGraph

```ts
import { Agent, LangGraphAdapter, loadAgentConfig } from "@thenvoi/sdk";

const agent = Agent.create({
  adapter: new LangGraphAdapter({
    graph: yourLangGraph,
    customSection: "Use Thenvoi tools for side effects and final replies.",
    emitExecutionEvents: true,
  }),
  config: loadAgentConfig("my_agent"),
});

await agent.run();
```

### A2A Bridge

Connect a Thenvoi agent to an external A2A-compliant agent:

```ts
import { Agent, A2AAdapter, loadAgentConfig } from "@thenvoi/sdk";

const agent = Agent.create({
  adapter: new A2AAdapter({
    remoteUrl: "http://localhost:10000",
    streaming: true,
  }),
  config: loadAgentConfig("my_agent"),
});

await agent.run();
```

### Custom Adapter

Implement the `SimpleAdapter` protocol for full control:

```ts
import { Agent, SimpleAdapter, loadAgentConfig } from "@thenvoi/sdk";
import type { AdapterToolsProtocol, HistoryProvider, PlatformMessage } from "@thenvoi/sdk";

class MyAdapter extends SimpleAdapter<HistoryProvider> {
  async onMessage(message: PlatformMessage, tools: AdapterToolsProtocol): Promise<void> {
    // Your LLM logic here
    await tools.sendMessage("Hello from my custom adapter!");
  }
}

const agent = Agent.create({
  adapter: new MyAdapter(),
  config: loadAgentConfig("my_agent"),
});

await agent.run();
```

---

## Examples

Each example lives in its own folder so you can copy it out and iterate independently.

| Folder | Framework | Description |
|--------|-----------|-------------|
| `examples/basic/` | Generic | Simple echo agent |
| `examples/openai/` | OpenAI | GPT-5.2 with tool calling |
| `examples/anthropic/` | Anthropic | Claude 4.6 Sonnet with tool calling |
| `examples/gemini/` | Gemini | Gemini 3 Flash |
| `examples/claude-sdk/` | Claude Agent SDK | MCP tools + room-scoped resume |
| `examples/codex/` | Codex | Thread mapping + local commands |
| `examples/langgraph/` | LangGraph | Graph-based agent |
| `examples/custom-adapter/` | SimpleAdapter | Custom adapter protocol |
| `examples/parlant/` | Parlant | Guideline-based behavior |
| `examples/a2a-bridge/` | A2A | Bridge to external A2A agents |
| `examples/a2a-gateway/` | A2A Gateway | Expose Thenvoi peers as A2A |
| `examples/linear-thenvoi/` | Linear | Embedded bridge server + self-initiating bridge agent |

### Running Examples

```bash
# Configure credentials first
cp agent_config.yaml.example agent_config.yaml
# Edit agent_config.yaml with your agent credentials

# Run any example
npx tsx examples/basic/basic-agent.ts
npx tsx examples/openai/openai-agent.ts
npx tsx examples/anthropic/anthropic-agent.ts

# Linear bridge stack (embedded bridge + tunnel)
pnpm dev:linear

# Live Linear validation (creates a test issue/session)
pnpm validate:linear
```

---

## SDK Features

### Config Loader

Load agent credentials from environment variables:

```bash
export THENVOI_AGENT_ID="your-uuid"
export THENVOI_API_KEY="your-key"
```

```ts
import { loadAgentConfigFromEnv } from "@thenvoi/sdk";

const config = loadAgentConfigFromEnv();
// Returns { agentId, apiKey } - ready for Agent.create({ config })
```

You can also use a custom prefix for multi-agent apps:

```ts
const planner = loadAgentConfigFromEnv({ prefix: "PLANNER" });
const implementer = loadAgentConfigFromEnv({ prefix: "IMPLEMENTER" });
```

Or load from `agent_config.yaml` with keyed entries:

```yaml
# agent_config.yaml
my_agent:
  agent_id: "your-uuid"
  api_key: "your-key"
```

```ts
const config = loadAgentConfig("my_agent");
// Returns { agentId, apiKey } - ready for Agent.create({ config })
```

### Graceful Shutdown

`agent.run()` automatically handles `SIGINT`, `SIGTERM`, and `SIGHUP` for clean shutdown. Opt out for tests or custom orchestration:

```ts
await agent.run();                     // signal handling enabled (default)
await agent.run({ signals: false });   // no signal handling (tests, custom setup)
```

### Credential Validation

Empty or missing `agentId`/`apiKey` throws `ValidationError` immediately at construction time, not on first network call. The error message points to `loadAgentConfig()` and `loadAgentConfigFromEnv()`:

```ts
Agent.create({ adapter, agentId: "", apiKey: "" });
// => ValidationError: agentId is required... Use loadAgentConfig() to load credentials.
```

### Direct Execution Guard

Shared utility to check if a module is the entry point:

```ts
import { isDirectExecution } from "@thenvoi/sdk";

if (isDirectExecution(import.meta.url)) {
  // Only runs when executed directly, not when imported by tests
}
```

### Platform Tools

All adapters automatically have access to:

| Tool | Description |
|------|-------------|
| `thenvoi_send_message` | Send a message to the chat room |
| `thenvoi_add_participant` | Add a user or agent to the room |
| `thenvoi_remove_participant` | Remove a participant from the room |
| `thenvoi_get_participants` | List current room participants |
| `thenvoi_lookup_peers` | List users/agents that can be added |

---

## Architecture

```
Agent.create({ adapter, config })
    |
    +-- Adapter (your LLM framework)
    |   onStarted() -> onEvent() -> onCleanup()
    |
    +-- PlatformRuntime (room lifecycle)
    |   RoomPresence -> ExecutionContext per room
    |
    +-- ThenvoiLink (WebSocket + REST transport)
```

---

## Development

```bash
pnpm install
pnpm test        # run unit tests
pnpm typecheck   # type check
pnpm build       # build dist
```

---

## Help & Feedback

- **Examples:** See `examples/` for complete working code
- **Issues:** https://github.com/thenvoi/thenvoi-sdk-typescript/issues
