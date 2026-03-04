import express, { type NextFunction, type Request, type Response } from "express";
import { LinearClient } from "@linear/sdk";
import { LinearWebhookClient } from "@linear/sdk/webhooks";

import {
  ConsoleLogger,
  FernRestAdapter,
  type Logger,
  type RestApi,
  createSqliteSessionRoomStore,
  handleAgentSessionEvent,
  type LinearThenvoiBridgeConfig,
  type RoomStrategy,
  isDirectExecution,
} from "../../src/index";
import { ThenvoiClient } from "@thenvoi/rest-client";

interface LinearThenvoiBridgeServerOptions {
  restApi: RestApi;
  linearAccessToken: string;
  linearWebhookSecret: string;
  stateDbPath: string;
  hostAgentHandle: string;
  defaultSpecialistHandles?: string[];
  roomStrategy?: RoomStrategy;
  logger?: Logger;
}

export function createLinearThenvoiBridgeApp(options: LinearThenvoiBridgeServerOptions): express.Express {
  const logger = options.logger ?? new ConsoleLogger();
  const store = createSqliteSessionRoomStore(options.stateDbPath);
  const linearClient = new LinearClient({
    accessToken: options.linearAccessToken,
  });

  const bridgeConfig: LinearThenvoiBridgeConfig = {
    linearAccessToken: options.linearAccessToken,
    linearWebhookSecret: options.linearWebhookSecret,
    hostAgentHandle: options.hostAgentHandle,
    defaultSpecialistHandles: options.defaultSpecialistHandles ?? [],
    roomStrategy: options.roomStrategy,
    writebackMode: "final_only",
  };

  const app = express();
  app.disable("x-powered-by");

  app.get("/healthz", (_request, response) => {
    response.status(200).json({ ok: true });
  });

  const webhookClient = new LinearWebhookClient(options.linearWebhookSecret);
  const webhookHandler = webhookClient.createHandler();
  webhookHandler.on("AgentSessionEvent", async (payload) => {
    await handleAgentSessionEvent({
      payload,
      config: bridgeConfig,
      deps: {
        thenvoiRest: options.restApi,
        linearClient,
        store,
        logger,
      },
    });
  });

  app.post("/linear/webhook", async (request, response, next) => {
    try {
      await webhookHandler(request, response);
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    logger.error("linear_thenvoi_bridge.webhook_error", {
      error: error instanceof Error ? error.message : String(error),
    });

    if (response.headersSent) {
      return;
    }

    response.status(500).json({ ok: false, error: "webhook_error" });
  });

  return app;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

if (isDirectExecution(import.meta.url)) {
  const logger = new ConsoleLogger();
  const port = Number(process.env.PORT ?? "8787");

  try {
    const app = createLinearThenvoiBridgeApp({
      restApi: new FernRestAdapter(
        new ThenvoiClient({
          apiKey: process.env.THENVOI_API_KEY,
        }),
      ),
      linearAccessToken: getRequiredEnv("LINEAR_ACCESS_TOKEN"),
      linearWebhookSecret: getRequiredEnv("LINEAR_WEBHOOK_SECRET"),
      stateDbPath: process.env.LINEAR_THENVOI_STATE_DB ?? ".linear-thenvoi-example.sqlite",
      hostAgentHandle: process.env.THENVOI_HOST_AGENT_HANDLE ?? "linear-host",
      defaultSpecialistHandles: (process.env.THENVOI_DEFAULT_SPECIALISTS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
      roomStrategy: (process.env.LINEAR_THENVOI_ROOM_STRATEGY as RoomStrategy | undefined) ?? "issue",
      logger,
    });

    app.listen(port, () => {
      logger.info("linear_thenvoi_bridge.server_started", {
        port,
        mode: "example_rest_stub",
      });
    });
  } catch (error) {
    logger.error("linear_thenvoi_bridge.startup_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}
