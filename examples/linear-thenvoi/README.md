# Linear + Thenvoi Example

This example demonstrates a Thenvoi-hosted orchestrator agent integrated with Linear Agent Sessions.

Note: the SQLite mapping helper uses `node:sqlite`, which requires Node.js 22+.

## What it shows

1. Linear `AgentSessionEvent` webhooks are verified with `@linear/sdk/webhooks`.
2. Sessions are mapped to Thenvoi rooms using a SQLite-backed mapping store.
3. The bridge forwards session context into Thenvoi room messages.
4. The orchestrator agent can add specialist agents in-room.
5. The final response is posted back to Linear via `createAgentActivity`.

## Files

- `examples/linear-thenvoi/linear-thenvoi-bridge-server.ts`
  Node/Express webhook server that maps Linear sessions to Thenvoi rooms.
- `examples/linear-thenvoi/linear-thenvoi-orchestrator-agent.ts`
  Thenvoi-hosted orchestrator agent using `GenericAdapter`.
- `examples/linear-thenvoi/linear-thenvoi-rest-stub.ts`
  In-memory `RestApi` implementation used by the example.

## Run the bridge server example

```bash
export LINEAR_ACCESS_TOKEN=lin_api_xxx
export LINEAR_WEBHOOK_SECRET=your-webhook-secret
export THENVOI_HOST_AGENT_HANDLE=linear-host
pnpm tsx examples/linear-thenvoi/linear-thenvoi-bridge-server.ts
```

The direct run mode uses `LinearThenvoiExampleRestApi` (in-memory) for demonstration.
For production wiring, pass a real Thenvoi `RestApi` implementation into `createLinearThenvoiBridgeApp`.

## Run the orchestrator example

```bash
export LINEAR_ACCESS_TOKEN=lin_api_xxx
pnpm tsx examples/linear-thenvoi/linear-thenvoi-orchestrator-agent.ts
```

## Room strategy

`handleAgentSessionEvent` supports:

- `roomStrategy: "issue"` (default): share one Thenvoi room per Linear issue
- `roomStrategy: "session"`: dedicate one Thenvoi room per Linear session
