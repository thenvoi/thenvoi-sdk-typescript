#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f ".env.local" ]]; then
  set -a
  # shellcheck source=/dev/null
  source ".env.local"
  set +a
fi

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env var: $name" >&2
    exit 1
  fi
}

require_env "LINEAR_ACCESS_TOKEN"
require_env "LINEAR_WEBHOOK_SECRET"
if [[ -z "${THENVOI_BRIDGE_API_KEY:-}" && -z "${THENVOI_API_KEY:-}" ]]; then
  echo "Missing required env var: THENVOI_BRIDGE_API_KEY or THENVOI_API_KEY" >&2
  exit 1
fi

PORT="${PORT:-8787}"
BRIDGE_LOG="${BRIDGE_LOG:-/tmp/thenvoi-linear-bridge.log}"
TUNNEL_LOG="${TUNNEL_LOG:-/tmp/thenvoi-linear-tunnel.log}"
PUBLIC_WEBHOOK_URL="${LINEAR_WEBHOOK_PUBLIC_URL:-}"
TAIL_LOGS="${LINEAR_THENVOI_TAIL_LOGS:-0}"
MAX_LOG_BYTES="${LINEAR_THENVOI_MAX_LOG_BYTES:-10485760}"

prepare_log_file() {
  local path="$1"
  local max_bytes="$2"
  local size=0

  mkdir -p "$(dirname "$path")"
  touch "$path"

  size="$(wc -c <"$path" | tr -d ' ')"
  if [[ "$size" -le "$max_bytes" ]]; then
    return
  fi

  local backup="${path}.previous"
  rm -f "$backup"
  mv "$path" "$backup"
  : >"$path"
  echo "Rotated oversized log: $path (${size} bytes) -> $backup"
}

cleanup() {
  local status=$?
  if [[ -n "${BRIDGE_PID:-}" ]]; then kill "$BRIDGE_PID" 2>/dev/null || true; fi
  if [[ -n "${TUNNEL_PID:-}" ]]; then kill "$TUNNEL_PID" 2>/dev/null || true; fi
  wait 2>/dev/null || true
  exit "$status"
}
trap cleanup INT TERM EXIT

if [[ -n "${THENVOI_BRIDGE_API_KEY:-}" ]]; then
  export THENVOI_API_KEY="${THENVOI_BRIDGE_API_KEY}"
fi

export LINEAR_THENVOI_EMBED_AGENT="${LINEAR_THENVOI_EMBED_AGENT:-1}"
export NODE_TLS_REJECT_UNAUTHORIZED="${NODE_TLS_REJECT_UNAUTHORIZED:-0}"

prepare_log_file "$BRIDGE_LOG" "$MAX_LOG_BYTES"
prepare_log_file "$TUNNEL_LOG" "$MAX_LOG_BYTES"

echo "Starting Linear bridge on :$PORT ..."
npm exec tsx examples/linear-thenvoi/linear-thenvoi-bridge-server.ts >"$BRIDGE_LOG" 2>&1 &
BRIDGE_PID=$!

if [[ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
  echo "Starting named Cloudflare tunnel ..."
  ./scripts/run-linear-tunnel.sh >"$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!
else
  echo "Starting quick Cloudflare tunnel ..."
  cloudflared tunnel --url "http://127.0.0.1:${PORT}" >"$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!
fi

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
  echo "Bridge did not become healthy; check $BRIDGE_LOG" >&2
  exit 1
fi

if [[ -z "$PUBLIC_WEBHOOK_URL" ]]; then
  if rg -o "https://[a-z0-9-]+\\.trycloudflare\\.com" "$TUNNEL_LOG" -m 1 >/dev/null 2>&1; then
    QUICK_URL="$(rg -o "https://[a-z0-9-]+\\.trycloudflare\\.com" "$TUNNEL_LOG" -m 1 | head -n 1)"
    PUBLIC_WEBHOOK_URL="${QUICK_URL}/linear/webhook"
  fi
fi

echo
echo "Linear dev stack is running."
echo "Bridge health: http://127.0.0.1:${PORT}/healthz"
if [[ -n "$PUBLIC_WEBHOOK_URL" ]]; then
  echo "Webhook URL: $PUBLIC_WEBHOOK_URL"
else
  echo "Webhook URL: unknown (set LINEAR_WEBHOOK_PUBLIC_URL for named tunnels)."
fi
echo "Logs:"
echo "  bridge: $BRIDGE_LOG"
echo "  tunnel: $TUNNEL_LOG"
echo "Manual tail: tail -f \"$BRIDGE_LOG\" \"$TUNNEL_LOG\""
echo
echo "Press Ctrl+C to stop all processes."

if [[ "$TAIL_LOGS" == "1" ]]; then
  tail -F "$BRIDGE_LOG" "$TUNNEL_LOG"
fi

while kill -0 "$BRIDGE_PID" 2>/dev/null && kill -0 "$TUNNEL_PID" 2>/dev/null; do
  sleep 5
done

wait "$BRIDGE_PID" "$TUNNEL_PID"
