# Linear + Thenvoi Example

This example implements the Linear bridge flow in `thenvoi-sdk-typescript`: Linear sends an `AgentSessionEvent`, the webhook handler verifies it with `@linear/sdk/webhooks`, posts an immediate acknowledgment thought, then hands the task directly into a single running Linear-aware bridge agent that can self-initiate, discover relevant peers, coordinate specialist agents, and write progress back to Linear.

The realistic demo path is:
- the user asks `@Thenvoi` to enrich a vague ticket
- the bridge decides whether any peer would help and may invite a planning-oriented specialist to sharpen title, scope, and acceptance criteria
- later, when the issue is moved to `In Progress`, the bridge reevaluates the ticket and may invite an implementation-oriented specialist
- the specialist works in its own isolated temp workspace and reports back concrete files
- the bridge moves the issue to `In Review` and posts the final Linear summary

The SQLite session-room mapping uses `node:sqlite`, so this example requires Node.js 22+.

## Files

- `examples/linear-thenvoi/linear-thenvoi-bridge-server.ts`
  Express webhook server using `createLinearWebhookHandler(...)`, a shared SQLite session-room store, and an embedded dispatcher that can bootstrap the running bridge agent directly.
- `examples/linear-thenvoi/linear-thenvoi-bridge-agent.ts`
  Thenvoi-hosted bridge agent with two adapter modes:
  - `scripted` (default, deterministic dogfood path)
  - `codex` (full model-driven bridge with Linear tools)
- `examples/linear-thenvoi/linear-thenvoi-rest-stub.ts`
  In-memory `RestApi` used by tests only.

## Architecture

1. Linear sends `AgentSessionEvent` webhooks to `/linear/webhook`.
2. `createLinearWebhookHandler(...)` verifies the HMAC signature using the raw request body.
3. A `thought` activity is posted to Linear immediately for `created` events.
4. The event is queued for async bridge processing, which resolves or reuses a Thenvoi room.
5. In the default embedded mode, the webhook server bootstraps the running bridge agent directly from the shared store, so no second bridge-agent process or transport identity is required.
6. The Linear bridge agent uses Thenvoi platform tools plus Linear writeback tools:
   - `post_thought`
   - `post_action`
   - `post_error`
   - `post_elicitation`
   - `complete_session`
   - `linear_list_workflow_states`
   - `linear_update_issue`
   - `linear_add_issue_comment`
7. Specialists communicate only over Thenvoi room messaging. They do not use Linear tools directly, and the bridge decides whether to invite them based on the request at hand.
8. `complete_session` posts the final Linear response and marks the shared SQLite session record as `completed`.

## Environment

The embedded mode starts the bridge agent inside the webhook server process by default. If you choose to run the bridge agent separately, both processes should point at the same state DB so they share session lifecycle state.

```bash
export LINEAR_ACCESS_TOKEN=lin_api_xxx
export LINEAR_WEBHOOK_SECRET=linear_webhook_secret
export LINEAR_THENVOI_STATE_DB=.linear-thenvoi-example.sqlite
export LINEAR_THENVOI_ROOM_STRATEGY=issue
export LINEAR_THENVOI_WRITEBACK_MODE=activity_stream
export THENVOI_REST_URL=https://app.thenvoi.com
export LINEAR_WEBHOOK_PUBLIC_URL=https://linear-webhook.your-domain.com/linear/webhook
```

Bridge server env:

```bash
export THENVOI_API_KEY=thenvoi_api_xxx
# Optional override if the webhook server should authenticate differently
export THENVOI_BRIDGE_API_KEY=thenvoi_api_bridge_xxx
```

The direct bridge server example now uses `FernRestAdapter` backed by `@thenvoi/rest-client`, while still targeting the agent-scoped `/api/v1/agent/*` endpoints.
The bridge creates agent chats without `task_id` unless you have a real Thenvoi task UUID. Linear issue IDs and session IDs are not valid substitutes for the `chat.task_id` field accepted by the agent API.
`THENVOI_HOST_AGENT_HANDLE` is optional for the bridge; when omitted, the bridge resolves the host handle from `/api/v1/agent/me` so it always matches the authenticated agent in `agent_config.yaml`.
If `THENVOI_REST_URL` is omitted, the example defaults to `https://app.thenvoi.com`.
The default path is a single visible bridge agent identity. `THENVOI_BRIDGE_API_KEY` remains available only if you explicitly want the webhook server to authenticate differently.
`LINEAR_THENVOI_EMBED_AGENT=1` is the default. Set `LINEAR_THENVOI_EMBED_AGENT=0` only if you intentionally want the legacy split server/agent setup.
Recommended `agent_config.yaml` role key:
- `linear_thenvoi_bridge`: identity that runs the Linear-aware Codex bridge agent.

## One-Command Dev Startup

From repo root:

```bash
pnpm dev:linear
```

This starts:
- bridge server
- Cloudflare tunnel (named if `CLOUDFLARE_TUNNEL_TOKEN` is set; quick tunnel otherwise)

The script prints the webhook URL and tails logs so the stack is observable while developing.

## Run planner + coder specialists

Start the specialist pair in a separate terminal:

```bash
pnpm dev:linear:specialists
```

This launches:
- a planning-oriented specialist agent
- an implementation-oriented specialist agent

They remain Linear-agnostic. The bridge decides whether they are worth inviting for the current request.

By default each specialist gets its own fresh temp workspace. You can override those with:

```bash
export LINEAR_THENVOI_PLANNER_CWD=/absolute/path/to/planner-workdir
export LINEAR_THENVOI_CODER_CWD=/absolute/path/to/coder-workdir
```

Or keep temp dirs but pin them under a shared root:

```bash
export LINEAR_THENVOI_SPECIALIST_TMPDIR=/absolute/path/to/tmp-root
```

You can also override which configured Thenvoi identities are used:

```bash
export LINEAR_THENVOI_PLANNER_CONFIG_KEY=planner_agent
export LINEAR_THENVOI_CODER_CONFIG_KEY=codex_agent
```

The example config expects separate `planner_agent` and `codex_agent` entries in `agent_config.yaml` so the bridge can discover distinct specialists.

Adapter mode toggles:

```bash
# Bridge adapter mode
export LINEAR_THENVOI_BRIDGE_AGENT_MODE=scripted   # default
# export LINEAR_THENVOI_BRIDGE_AGENT_MODE=codex

# Specialist adapter mode
export LINEAR_THENVOI_SPECIALIST_MODE=scripted     # default
# export LINEAR_THENVOI_SPECIALIST_MODE=codex

# Bridge elicitation policy in Codex mode
# Default is disabled so unattended runs won't stall on questions.
# export LINEAR_THENVOI_ALLOW_ELICITATION=1

# Optional hard timeout for a single Codex bridge session (ms).
# Unset by default; only set if you want forced fallback behavior.
# export LINEAR_THENVOI_CODEX_SESSION_TIMEOUT_MS=120000

# Legacy convenience override
# export LINEAR_THENVOI_FORCE_CODEX=1
```

## Live Validation

Run a real end-to-end check against your Linear workspace:

```bash
pnpm validate:linear
```

This creates a temporary issue + agent session, waits for the session to reach `complete`, requires at least one final response activity, and fails if a bridge error appears.

## Full Dogfood Run

Run the realistic bridge + specialists + Linear scenario matrix in one command:

```bash
pnpm dogfood:linear
```

What it does:
- starts `pnpm dev:linear`
- starts `pnpm dev:linear:specialists`
- creates a real Linear issue in `LINEAR_TEAM_ID`
- runs an enrichment session on the issue
- moves the issue to an in-progress state
- runs implementation and follow-up sessions from real issue comments
- verifies the issue reaches a review state and writes a report under `/tmp/thenvoi-linear-dogfood-*`
- writes per-session activity traces to `logs/session-*.jsonl` for local observability

Notes:
- This depends on your Linear agent-session webhook already pointing at the tunnel or public URL used by the bridge stack.
- If you use a stable named tunnel, set `LINEAR_WEBHOOK_PUBLIC_URL` so the run can verify the expected URL directly.
- The dogfood script leaves the created issue in Linear for inspection.

## Run the bridge server

```bash
pnpm tsx examples/linear-thenvoi/linear-thenvoi-bridge-server.ts
```

The server exposes:

- `GET /healthz`
- `POST /linear/webhook`

Use `express.raw({ type: "*/*" })` or equivalent raw-body handling if you embed `createLinearWebhookHandler(...)` into another server, otherwise Linear signature verification will fail.
By default this command also starts the Linear bridge agent in-process. Set `LINEAR_THENVOI_EMBED_AGENT=0` if you want the webhook server only.

## Run the bridge agent

`linear-thenvoi-bridge-agent.ts` uses `loadAgentConfig("linear_thenvoi_bridge")`, so it still needs normal Thenvoi agent credentials in `agent_config.yaml` or prefixed env vars in addition to the Linear credentials above. It also requires the local `codex` CLI to be installed and authenticated. This standalone process is now optional; the server embeds it by default.

```bash
pnpm tsx examples/linear-thenvoi/linear-thenvoi-bridge-agent.ts
```

In `scripted` mode, this process runs deterministic bridge logic for stable dogfood runs (including planner/coder collaboration and Linear writeback). In `codex` mode, it uses `CodexAdapter` plus dynamic tools. The bridge does not hardcode specific peer handles into its orchestration logic.

## Configuration Notes

- `roomStrategy: "issue"` keeps one Thenvoi room per Linear issue. When a new Linear session starts after the previous one completed or errored, the embedded bridge resets the room runtime and Codex thread state before bootstrapping the new session into that same room.
- `roomStrategy: "session"` creates a dedicated Thenvoi room per Linear agent session.
- `writebackMode: "activity_stream"` is the example default and is passed into the room context for the bridge agent.
- `writebackMode: "final_only"` is available when you want the room to produce a final answer without intermediate Linear activity updates.
- The bridge room payload now includes issue state and assignee so the bridge can distinguish enrichment from implementation kickoff.
- `linear_list_workflow_states` lets the bridge resolve the correct team-specific `In Review` state before calling `linear_update_issue`.
