#!/usr/bin/env bash
set -euo pipefail

if [[ -f ".env.local" ]]; then
  set -a
  # shellcheck source=/dev/null
  source ".env.local"
  set +a
fi

if [[ -z "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_TUNNEL_TOKEN is required (set in .env.local or shell env)." >&2
  exit 1
fi

ORIGIN_URL="${LINEAR_BRIDGE_ORIGIN_URL:-http://127.0.0.1:8787}"
exec cloudflared tunnel --url "${ORIGIN_URL}" run --token "${CLOUDFLARE_TUNNEL_TOKEN}" "${CLOUDFLARE_TUNNEL_ID:-thenvoi-linear-darvai}"
