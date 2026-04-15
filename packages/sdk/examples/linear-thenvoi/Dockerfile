FROM node:22-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

RUN mkdir -p /app/data

ENV PORT=8787
ENV LINEAR_THENVOI_STATE_DB=/app/data/state.sqlite
ENV LINEAR_THENVOI_PROMPT_PATH=/app/prompt.md

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD curl -f http://localhost:8787/healthz || exit 1

CMD ["npx", "tsx", "linear-thenvoi-bridge-server.ts"]
