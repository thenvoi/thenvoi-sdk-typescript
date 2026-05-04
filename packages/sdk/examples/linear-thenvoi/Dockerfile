FROM node:22-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Patch: @thenvoi/sdk <=0.1.4 imports "sqlite" instead of "node:sqlite".
# Fixed in source; upstream publish pending. Safe on already-fixed versions (no-op).
RUN sed -i 's|await import("sqlite")|await import("node:sqlite")|' \
    /app/node_modules/@thenvoi/sdk/dist/linear.js \
    /app/node_modules/@thenvoi/sdk/dist/linear.cjs 2>/dev/null || true

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /app/data

ENV PORT=8787
ENV LINEAR_THENVOI_STATE_DB=/app/data/state.sqlite
ENV LINEAR_THENVOI_PROMPT_PATH=/app/prompt.md
ENV PATH=/app/node_modules/.bin:$PATH

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD curl -f http://localhost:8787/healthz || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npx", "tsx", "linear-thenvoi-bridge-server.ts"]
