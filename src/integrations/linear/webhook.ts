import type { IncomingMessage, ServerResponse } from "node:http";

import {
  LinearWebhookClient,
  LINEAR_WEBHOOK_SIGNATURE_HEADER,
  LINEAR_WEBHOOK_TS_HEADER,
  type AgentSessionEventWebhookPayload,
} from "@linear/sdk/webhooks";

import { NoopLogger, type Logger } from "../../core/logger";
import { postThought } from "./activities";
import {
  getAgentSessionEventKey,
  handleAgentSessionEvent,
} from "./bridge";
import type {
  HandleAgentSessionEventInput,
  LinearThenvoiBridgeConfig,
  LinearThenvoiBridgeDeps,
} from "./types";

export interface LinearBridgeDispatchJob {
  eventKey: string;
  input: HandleAgentSessionEventInput;
}

export interface LinearBridgeDispatcher {
  dispatch(job: LinearBridgeDispatchJob): void;
  isQueued?(eventKey: string): boolean;
}

export interface CreateLinearWebhookHandlerOptions {
  config: LinearThenvoiBridgeConfig;
  deps: LinearThenvoiBridgeDeps;
  dispatcher?: LinearBridgeDispatcher;
}

type NodeRequestWithBody = IncomingMessage & {
  body?: Buffer | string | Uint8Array | null;
};

const DISPATCH_RETRY_LIMIT = 2;
const DISPATCH_RETRY_BASE_DELAY_MS = 1_000;

export function createInProcessLinearBridgeDispatcher(
  options?: { logger?: Logger },
): LinearBridgeDispatcher {
  const logger = options?.logger ?? new NoopLogger();
  const queued = new Set<string>();

  return {
    isQueued: (eventKey: string) => queued.has(eventKey),
    dispatch: (job: LinearBridgeDispatchJob) => {
      if (queued.has(job.eventKey)) {
        return;
      }

      queued.add(job.eventKey);
      queueMicrotask(() => {
        void runDispatchAttempt(async () => {
          await handleAgentSessionEvent(job.input, {
            skipAcknowledgment: true,
            expectedEventKey: job.eventKey,
          });
        }, {
          logger,
          failureEvent: "linear_thenvoi_bridge.async_dispatch_failed",
          retryEvent: "linear_thenvoi_bridge.async_dispatch_retrying",
          eventKey: job.eventKey,
          sessionId: job.input.payload.agentSession.id,
        }).finally(() => {
          queued.delete(job.eventKey);
        });
      });
    },
  };
}

export function createLinearWebhookHandler(
  options: CreateLinearWebhookHandlerOptions,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const logger = options.deps.logger ?? new NoopLogger();
  const dispatcher = options.dispatcher ?? createInProcessLinearBridgeDispatcher({ logger });
  const webhookClient = new LinearWebhookClient(options.config.linearWebhookSecret);

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") {
      logger.warn("linear_thenvoi_bridge.webhook_invalid_method", {
        method: request.method ?? null,
      });
      sendText(response, 405, "Method not allowed");
      return;
    }

    const signature = getHeaderValue(request, LINEAR_WEBHOOK_SIGNATURE_HEADER);
    if (!signature) {
      logger.warn("linear_thenvoi_bridge.webhook_missing_signature", {});
      sendText(response, 400, "Missing webhook signature");
      return;
    }

    const rawBody = await readRawBody(request as NodeRequestWithBody);
    let payload: AgentSessionEventWebhookPayload;
    try {
      const timestamp = getHeaderValue(request, LINEAR_WEBHOOK_TS_HEADER) ?? undefined;
      payload = webhookClient.parseData(
        rawBody,
        signature,
        timestamp,
      ) as AgentSessionEventWebhookPayload;
    } catch (error) {
      logger.warn("linear_thenvoi_bridge.webhook_invalid_signature", {
        error: error instanceof Error ? error.message : String(error),
      });
      sendText(response, 400, "Invalid webhook");
      return;
    }

    if (payload.type !== "AgentSessionEvent") {
      logger.info("linear_thenvoi_bridge.webhook_ignored_event", {
        type: payload.type,
      });
      sendText(response, 200, "OK");
      return;
    }

    const eventKey = getAgentSessionEventKey(payload);
    logger.info("linear_thenvoi_bridge.webhook_received", {
      sessionId: payload.agentSession.id,
      issueId: payload.agentSession.issue?.id ?? null,
      action: payload.action,
      eventKey,
    });
    const existing = await options.deps.store.getBySessionId(payload.agentSession.id);
    if (existing?.lastEventKey === eventKey || dispatcher.isQueued?.(eventKey)) {
      logger.info("linear_thenvoi_bridge.webhook_duplicate_ignored", {
        sessionId: payload.agentSession.id,
        eventKey,
      });
      sendText(response, 200, "OK");
      return;
    }

    if (normalizeAction(payload.action) === "created") {
      try {
        await postThought(
          options.deps.linearClient,
          payload.agentSession.id,
          "Received session. Setting up workspace...",
        );
      } catch (error) {
        logger.warn("linear_thenvoi_bridge.webhook_acknowledgment_failed", {
          sessionId: payload.agentSession.id,
          error,
        });
      }
    }

    dispatcher.dispatch({
      eventKey,
      input: {
        payload,
        config: options.config,
        deps: options.deps,
      },
    });
    logger.info("linear_thenvoi_bridge.webhook_dispatched", {
      sessionId: payload.agentSession.id,
      issueId: payload.agentSession.issue?.id ?? null,
      action: payload.action,
      eventKey,
    });

    sendText(response, 200, "OK");
  };
}

function normalizeAction(action: string | null | undefined): string {
  return typeof action === "string" ? action.trim().toLowerCase() : "";
}

function getHeaderValue(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === "string" ? value : null;
}

async function readRawBody(request: NodeRequestWithBody): Promise<Buffer> {
  if (Buffer.isBuffer(request.body)) {
    return request.body;
  }

  if (typeof request.body === "string") {
    return Buffer.from(request.body);
  }

  if (request.body instanceof Uint8Array) {
    return Buffer.from(request.body);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sendText(response: ServerResponse, statusCode: number, body: string): void {
  if (response.headersSent) {
    return;
  }

  response.statusCode = statusCode;
  response.end(body);
}

async function runDispatchAttempt(
  task: () => Promise<void>,
  context: {
    logger: Logger;
    failureEvent: string;
    retryEvent: string;
    eventKey: string;
    sessionId: string;
  },
): Promise<void> {
  let attempt = 0;

  while (true) {
    try {
      await task();
      return;
    } catch (error) {
      if (!isRetryableDispatchError(error) || attempt >= DISPATCH_RETRY_LIMIT) {
        context.logger.error(context.failureEvent, {
          eventKey: context.eventKey,
          sessionId: context.sessionId,
          error,
        });
        return;
      }

      attempt += 1;
      context.logger.warn(context.retryEvent, {
        eventKey: context.eventKey,
        sessionId: context.sessionId,
        attempt,
        delayMs: DISPATCH_RETRY_BASE_DELAY_MS * attempt,
        error,
      });
      await sleep(DISPATCH_RETRY_BASE_DELAY_MS * attempt);
    }
  }
}

function isRetryableDispatchError(error: unknown): error is { retryable: true } {
  return typeof error === "object" && error !== null && "retryable" in error && (error as { retryable?: boolean }).retryable === true;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
