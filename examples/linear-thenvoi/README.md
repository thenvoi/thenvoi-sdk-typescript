# Linear + Thenvoi Example

This example is the real Linear bridge path:

1. Linear sends an `AgentSessionEvent` webhook to `/linear/webhook`
2. the bridge resolves or reuses a Thenvoi room for that issue
3. the embedded bridge agent coordinates real Thenvoi specialists in that room
4. the bridge writes progress and the final response back to Linear

The bridge is the only Linear-aware participant. Planner, reviewer, and coder agents stay Linear-agnostic and communicate only through Thenvoi room messages.

The SQLite session-room mapping uses `node:sqlite`, so this example requires Node.js 22+.

## Files

- `examples/linear-thenvoi/linear-thenvoi-bridge-server.ts`
  Real webhook server and embedded bridge runtime.
- `examples/linear-thenvoi/linear-thenvoi-bridge-agent.ts`
  Real bridge agent using the Codex adapter and Linear tools.

## Environment

```bash
export LINEAR_ACCESS_TOKEN=lin_api_xxx
export LINEAR_WEBHOOK_SECRET=linear_webhook_secret
export THENVOI_API_KEY=thenvoi_api_xxx
export THENVOI_REST_URL=https://app.thenvoi.com
export LINEAR_WEBHOOK_PUBLIC_URL=https://linear-webhook.your-domain.com/linear/webhook
```

Optional:

```bash
export LINEAR_THENVOI_STATE_DB=.linear-thenvoi-example.sqlite
export LINEAR_THENVOI_ROOM_STRATEGY=issue
export LINEAR_THENVOI_WRITEBACK_MODE=activity_stream
export THENVOI_BRIDGE_API_KEY=thenvoi_api_bridge_xxx
```

Recommended agent config key:

- `linear_thenvoi_bridge`

## Run The Bridge

```bash
pnpm dev:linear
```

This starts:

- the webhook server
- the embedded bridge agent
- the Cloudflare tunnel

It prints:

- local health URL
- public webhook URL
- bridge and tunnel log paths

## Live Validation

```bash
pnpm validate:linear
```

This runs a real Linear end-to-end validation against the live bridge path.

## Architecture Notes

- `roomStrategy: "issue"` keeps one Thenvoi room per Linear issue.
- `roomStrategy: "session"` creates a new Thenvoi room per Linear session.
- `writebackMode: "activity_stream"` posts intermediate Linear activity updates.
- `writebackMode: "final_only"` keeps writeback minimal until completion.
- The bridge uses peer discovery and room context to pick relevant external specialists at runtime.
- For planning work, the bridge should send the full issue context to the planner, end its turn, and continue when specialist output appears.
