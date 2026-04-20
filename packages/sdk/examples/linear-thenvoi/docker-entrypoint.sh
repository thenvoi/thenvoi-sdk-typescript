#!/bin/sh
set -e

# Ensure the Rust codex binary has a stored API key.
# The TypeScript codex-sdk spawns `codex app-server` which requires
# ~/.codex/auth.json; it does NOT fall back to $OPENAI_API_KEY at runtime.
#
# We log in on every start if auth is missing. The codex home directory
# is mounted as a volume in docker-compose, so this is a no-op on subsequent
# starts unless the volume is cleared.
if [ -n "$OPENAI_API_KEY" ]; then
  if [ ! -f /root/.codex/auth.json ]; then
    echo "[entrypoint] codex auth missing; logging in with OPENAI_API_KEY"
    printenv OPENAI_API_KEY | codex login --with-api-key >/dev/null
  fi
fi

exec "$@"
