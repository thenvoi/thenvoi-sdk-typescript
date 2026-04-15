# Linear + Thenvoi Bridge

A webhook server that connects Linear Agent Sessions to Thenvoi multi-agent rooms. When a user starts an agent session on a Linear issue, this bridge receives the webhook, creates a Thenvoi room for the work, coordinates specialist agents (planner, reviewer, coder), and writes progress back to Linear.

The bridge agent is the only participant that talks to Linear. All other specialists communicate through the Thenvoi room and never need to know about Linear.

## Architecture

```
Linear Issue                                    Thenvoi Room
    |                                               |
    |  AgentSessionEvent webhook                     |
    v                                               |
+-----------------------+     resolve/create     +--+--+
|   Bridge Server       | ------------------>   | Room |
|   (this example)      |                       +--+--+
+-----------------------+                          |
    |         ^                                    |
    |         |  writeback                  +------+------+
    |         |  (thoughts, actions,        |      |      |
    |         |   plan updates,        Planner  Reviewer  Coder
    |         |   final response)      Agent    Agent     Agent
    |         |                             |      |      |
    +----<----+----<---synthesize output----<------<+------+
```

1. Linear sends an `AgentSessionEvent` webhook to `/linear/webhook`
2. The bridge resolves (or creates) a Thenvoi room for that issue
3. The embedded bridge agent reads the session payload, decides what kind of work is needed, and invites the right specialists
4. Specialists do the work in the room -- planning, reviewing, or coding
5. The bridge synthesizes the output and writes it back to Linear

## Prerequisites

- Node.js 22+ (required for the built-in `node:sqlite` module)
- A Linear workspace with API access
- A Thenvoi account with at least one agent configured
- An OpenAI API key (the bridge defaults to the Codex adapter with `gpt-5.4-mini`, but you can pass any `FrameworkAdapter` via the `adapter` option)
- A tunnel tool for local development (e.g., `cloudflared`, `ngrok`) so Linear can reach your local server

## Setting Up Linear

### 1. Create a Personal API Key

1. Open Linear and go to **Settings** (gear icon in the sidebar)
2. In the left panel under your account settings, click **Security & access**
3. Scroll to **Personal API keys** and click **New API key**
4. Give it a label (e.g., "Thenvoi Bridge") and create it
5. Copy the key -- it starts with `lin_api_`

This goes into your `.env` as `LINEAR_ACCESS_TOKEN`.

### 2. Enable Linear Agent

1. In Settings, go to **Features > AI & Agents** in the left sidebar
2. Make sure **Linear Agent** is enabled for your workspace
3. If you see "Start free trial", you may need a Business or Enterprise plan for full agent functionality

### 3. Create an OAuth Application

Agent Session events (the events that trigger this bridge) are delivered through an OAuth application, not through regular workspace webhooks. You need to create one.

1. In Settings, go to **Administration > API** in the left sidebar
2. Under **OAuth Applications**, click the **+** button
3. Fill in the application details:
   - **Application name**: "Thenvoi Bridge" (or whatever you want users to see)
   - **Developer name**: Your name or organization
   - **Developer URL**: Your project's homepage (can be any valid URL)
   - **Description**: "Thenvoi multi-agent bridge for Linear"
   - **Callback URLs**: Your bridge's OAuth callback URL (e.g., `https://your-domain.com/linear/oauth/callback`)
4. Enable the **Webhooks** toggle at the bottom of the form
5. Fill in the webhook fields that appear:
   - **Webhook URL**: Your bridge's public endpoint, e.g., `https://your-tunnel.trycloudflare.com/linear/webhook`
   - **Webhook signing secret**: Auto-generated (`lin_wh_...`). Copy it using the copy button.
6. Under **App events**, check **Agent session events** -- this is the event type that triggers the bridge when a user starts an agent session on an issue
7. Optionally check **Inbox notifications** if you want the bridge to handle inbox events too
8. Click **Create**

The webhook signing secret goes into your `.env` as `LINEAR_WEBHOOK_SECRET`.

After creating the application, you will receive a **Client ID** and **Client Secret**. The OAuth application must be installed in the workspace using the `actor=app` flow so that agent sessions are routed to your bridge.

> **Why an OAuth application?** Regular workspace webhooks only deliver data change events (Issue, Comment, etc.). Agent Session events are app-specific -- they are sent only to the OAuth application that owns the session. The bridge receives these events at the webhook URL you configured in the OAuth app.

## Setting Up Thenvoi

### 1. Create an Agent

1. Sign up or log in at [app.thenvoi.com](https://app.thenvoi.com)
2. Create a new agent for the bridge
3. Note the **Agent ID** and **API Key**

### 2. Configure `agent_config.yaml`

Create an `agent_config.yaml` file in this directory:

```yaml
linear_thenvoi_bridge:
  agent_id: your-agent-id
  api_key: thnv_a_xxx
```

The config key `linear_thenvoi_bridge` is the default. You can change it with the `LINEAR_THENVOI_BRIDGE_RUNTIME_CONFIG_KEY` env var.

### 3. Set Up Specialist Agents (Optional)

The bridge works best when it can delegate to specialist agents already registered in Thenvoi:

- A **planner** agent for breaking down issues into implementation plans
- A **reviewer** agent for tightening plans and reviewing work
- A **coder/developer** agent for producing implementation artifacts

The bridge discovers these by inspecting peer names, handles, and descriptions at runtime. No hardcoded mapping is needed.

## Configuration Reference

### Required

| Variable | Description |
|---|---|
| `LINEAR_ACCESS_TOKEN` | Linear personal API key (`lin_api_...`) |
| `LINEAR_WEBHOOK_SECRET` | Linear webhook signing secret (`lin_wh_...`) |
| `THENVOI_API_KEY` | Thenvoi API key (also configurable via `agent_config.yaml`) |

### Optional

| Variable | Default | Description |
|---|---|---|
| `THENVOI_REST_URL` | `https://app.thenvoi.com` | Thenvoi REST API endpoint |
| `THENVOI_HOST_AGENT_HANDLE` | -- | Bridge agent handle (`your-org/agent-name`) |
| `LINEAR_THENVOI_ROOM_STRATEGY` | `issue` | `issue` = one room per issue, `session` = new room each time |
| `LINEAR_THENVOI_WRITEBACK_MODE` | `activity_stream` | `activity_stream` = intermediate updates, `final_only` = minimal |
| `LINEAR_THENVOI_STATE_DB` | `.linear-thenvoi-example.sqlite` | Path to SQLite database for session-room mapping |
| `LINEAR_THENVOI_PROMPT_PATH` | `./prompt.md` (relative to server script) | Path to the agent prompt file |
| `LINEAR_THENVOI_EMBED_AGENT` | `true` | Run the bridge agent in-process (`true`) or externally (`false`) |
| `CODEX_MODEL` | `gpt-5.4-mini` | OpenAI model for the bridge agent |
| `PORT` | `8787` | Webhook server port |
| `LINEAR_THENVOI_BRIDGE_RUNTIME_CONFIG_KEY` | `linear_thenvoi_bridge` | Config key in `agent_config.yaml` |

## Quick Start: Local

### 1. Install

```bash
npm install
```

If running inside the SDK monorepo, use `pnpm install` at the repo root instead.

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and fill in at minimum:

```
LINEAR_ACCESS_TOKEN=lin_api_your_key_here
LINEAR_WEBHOOK_SECRET=lin_wh_your_secret_here
THENVOI_API_KEY=thnv_a_your_key_here
```

Create `agent_config.yaml` with your Thenvoi agent credentials (see Thenvoi setup above).

### 3. Start a Tunnel

Linear needs a public URL to send webhooks to your local machine. Using Cloudflare:

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

This prints a URL like `https://some-words.trycloudflare.com`. Copy it.

Or using ngrok:

```bash
ngrok http 8787
```

Go back to your Linear webhook settings and update the URL to:

```
https://your-tunnel-url/linear/webhook
```

### 4. Start the Server

```bash
npm start
```

Or from the SDK monorepo:

```bash
cd packages/sdk
pnpm dev:linear
```

### 5. Verify

```bash
curl http://127.0.0.1:8787/healthz
# {"ok":true}
```

Go to a Linear issue and start an agent session. The bridge should receive the webhook and begin coordinating.

## Quick Start: Docker

### 1. Configure

```bash
cp .env.example .env
# Edit .env with your credentials
```

Create `agent_config.yaml` with your Thenvoi agent credentials (see Thenvoi setup above).

### 2. Build and Run

```bash
docker compose up --build
```

The server starts on port 8787 (configurable via `PORT` in `.env`). Point your Linear webhook URL at your host's public address with `/linear/webhook`.

### 3. View Logs

```bash
docker compose logs -f
```

### 4. Reset State

To clear the SQLite session-room mapping and start fresh:

```bash
docker compose down -v
docker compose up --build
```

## Customizing the Agent Prompt

The bridge agent's behavior is controlled by `prompt.md` in this directory. This file contains all the instructions for how the agent coordinates specialists, uses Linear tools, delegates work, and writes back results.

To customize:

1. Edit `prompt.md` directly
2. Or set `LINEAR_THENVOI_PROMPT_PATH` to point at a different file

The prompt is loaded at startup. Restart the server after making changes.

What the prompt controls:
- Which Linear tools the agent uses and when
- How it decides between planning, implementation, and enrichment
- The delegation contract with specialist agents
- Writeback frequency and content
- Repository selection behavior for implementation tasks

When running with Docker, the `docker-compose.yml` mounts `prompt.md` into the container at `/app/config/prompt.md`. Edit the local file and restart the container to pick up changes.

## Room Strategies

**`issue` (default):** One Thenvoi room per Linear issue. Subsequent agent sessions on the same issue reuse the existing room, preserving context from previous conversations.

**`session`:** A new Thenvoi room for each Linear agent session. Each session starts fresh. Use this when different sessions on the same issue are unrelated.

Set via `LINEAR_THENVOI_ROOM_STRATEGY` in your `.env`.

## Writeback Modes

**`activity_stream` (default):** The bridge posts intermediate updates to Linear as work progresses -- thoughts, actions, plan steps. The user sees a live feed of what the agent is doing.

**`final_only`:** Minimal writeback until the work is complete. Less noise during processing but less visibility into progress.

Set via `LINEAR_THENVOI_WRITEBACK_MODE` in your `.env`.

## Troubleshooting

**Webhook not receiving events:**
- Check your tunnel is running and forwarding to port 8787
- Confirm the webhook URL ends with `/linear/webhook` in Linear settings
- Verify the signing secret in `.env` matches the one shown in Linear's webhook form
- Check that Issues is checked in the webhook's Data change events

**Server starts but agent doesn't respond:**
- Check `agent_config.yaml` exists and has the `linear_thenvoi_bridge` key with valid `agent_id` and `api_key`
- Make sure `LINEAR_THENVOI_EMBED_AGENT` is `true` (default) for in-process agent mode
- The Codex adapter needs a valid `OPENAI_API_KEY` in your environment

**SQLite errors on startup:**
- This example requires Node.js 22+ for the built-in `node:sqlite` module
- Check your version: `node --version`

**Rate limiting (429 errors in logs):**
- The bridge has built-in rate limiting and retry logic for Thenvoi REST API calls
- Default minimum interval between requests: 2 seconds
- Persistent 429s usually resolve on their own after backoff

**Docker: prompt.md not found:**
- Make sure `prompt.md` exists in the same directory as `docker-compose.yml`
- The compose file mounts it read-only into the container

## Files

| File | Description |
|---|---|
| `linear-thenvoi-bridge-server.ts` | Express webhook server and embedded bridge runtime |
| `linear-thenvoi-bridge-agent.ts` | Bridge agent factory using the Codex adapter with Linear tools |
| `linear-thenvoi-rest-stub.ts` | Mock Thenvoi REST API for testing |
| `prompt.md` | Agent behavioral instructions (edit this to customize the agent) |
| `agent_config.yaml` | Thenvoi agent credentials (you create this, gitignored) |
| `.env` | Environment variables (copy from `.env.example`, gitignored) |
| `Dockerfile` | Container build definition |
| `docker-compose.yml` | One-command deployment with volumes |

## Security

These files are gitignored and should never be committed:

- `.env` and `.env.*` (except `.env.example`)
- `agent_config.yaml`
- `*.sqlite` files
- `*.pem` and `*.key` files
