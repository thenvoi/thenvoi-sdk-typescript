import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";

import type {
  GatewayA2AStatusUpdateEvent,
  GatewayCancelRequest,
  GatewayMessagePart,
  GatewayPeer,
  GatewayRequest,
  GatewayServerLike,
  GatewayServerOptions,
} from "./types";
import { buildStatusEvent } from "./statusEvent";
import { asNonEmptyString } from "../shared/coercion";

interface ExpressAppLike {
  use: (...args: unknown[]) => void;
  get: (...args: unknown[]) => void;
  listen: (
    port: number,
    host: string,
    callback?: () => void,
  ) => HttpServer;
}

type ExpressFactory =
  & ((...args: unknown[]) => ExpressAppLike)
  & {
    json: (options?: Record<string, unknown>) => unknown;
  };

interface RuntimeA2AServerModules {
  AGENT_CARD_PATH: string;
  DefaultRequestHandler: new (
    agentCard: Record<string, unknown>,
    taskStore: unknown,
    executor: {
      execute: (
        requestContext: Record<string, unknown>,
        eventBus: {
          publish: (event: unknown) => void;
          finished: () => void;
        },
      ) => Promise<void>;
      cancelTask: (
        taskId: string,
        eventBus: {
          publish: (event: unknown) => void;
          finished: () => void;
        },
      ) => Promise<void>;
    },
  ) => {
    getAgentCard: () => Promise<Record<string, unknown>>;
  };
  InMemoryTaskStore: new () => unknown;
  UserBuilder: {
    noAuthentication: (request: unknown) => Promise<unknown>;
  };
  agentCardHandler: (options: Record<string, unknown>) => unknown;
  jsonRpcHandler: (options: Record<string, unknown>) => unknown;
  restHandler: (options: Record<string, unknown>) => unknown;
  createExpressApp: ExpressFactory;
}

class GatewayPeerExecutor {
  private readonly peer: GatewayPeer;
  private readonly onRequest: GatewayServerOptions["onRequest"];
  private readonly onCancel?: GatewayServerOptions["onCancel"];

  public constructor(options: {
    peer: GatewayPeer;
    onRequest: GatewayServerOptions["onRequest"];
    onCancel?: GatewayServerOptions["onCancel"];
  }) {
    this.peer = options.peer;
    this.onRequest = options.onRequest;
    this.onCancel = options.onCancel;
  }

  public async execute(
    requestContext: Record<string, unknown>,
    eventBus: {
      publish: (event: unknown) => void;
      finished: () => void;
    },
  ): Promise<void> {
    const taskId = asNonEmptyString(requestContext.taskId) ?? randomUUID();
    const contextId = asNonEmptyString(requestContext.contextId) ?? randomUUID();
    const message = asA2AMessage(requestContext.userMessage, contextId, taskId);

    try {
      for await (const event of this.onRequest({
        peerId: this.peer.slug,
        taskId,
        contextId,
        message,
      })) {
        eventBus.publish(event);
        if (event.final) {
          break;
        }
      }
    } catch (error) {
      eventBus.publish(
        buildStatusEvent({
          taskId,
          contextId,
          state: "failed",
          final: true,
          text: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      eventBus.finished();
    }
  }

  public async cancelTask(
    taskId: string,
    eventBus: {
      publish: (event: unknown) => void;
      finished: () => void;
    },
  ): Promise<void> {
    const request: GatewayCancelRequest = {
      peerId: this.peer.slug,
      taskId,
    };
    await this.onCancel?.(request);

    eventBus.publish(
      buildStatusEvent({
        taskId,
        contextId: randomUUID(),
        state: "canceled",
        final: true,
        text: "Task canceled.",
      }),
    );
    eventBus.finished();
  }
}

export class GatewayServer implements GatewayServerLike {
  private readonly options: GatewayServerOptions;
  private server: HttpServer | null = null;
  private started = false;

  public constructor(options: GatewayServerOptions) {
    this.options = options;
  }

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }

    const modules = await loadA2AServerModules();
    const app = modules.createExpressApp();
    app.use(modules.createExpressApp.json({ limit: "1mb" }));

    app.get("/peers", (_request: unknown, response: { json: (body: unknown) => void }) => {
      const peers = [...this.options.peersBySlug.values()].map((peer) => ({
        slug: peer.slug,
        id: peer.id,
        name: peer.name,
        description: peer.description,
      }));

      response.json({
        peers,
        count: peers.length,
      });
    });

    for (const [slug, peer] of this.options.peersBySlug.entries()) {
      const requestHandler = new modules.DefaultRequestHandler(
        buildAgentCard(peer, this.options.gatewayUrl),
        new modules.InMemoryTaskStore(),
        new GatewayPeerExecutor({
          peer,
          onRequest: this.options.onRequest,
          onCancel: this.options.onCancel,
        }),
      );

      const userBuilder = modules.UserBuilder.noAuthentication;
      const peerBasePath = `/agents/${slug}`;

      app.get(
        `${peerBasePath}/.well-known/agent.json`,
        async (_request: unknown, response: { json: (body: unknown) => void }) => {
          response.json(await requestHandler.getAgentCard());
        },
      );

      app.use(
        `${peerBasePath}/${modules.AGENT_CARD_PATH}`,
        modules.agentCardHandler({
          agentCardProvider: requestHandler,
        }),
      );

      app.use(
        `${peerBasePath}/v1`,
        modules.restHandler({
          requestHandler,
          userBuilder,
        }),
      );

      app.use(
        peerBasePath,
        modules.jsonRpcHandler({
          requestHandler,
          userBuilder,
        }),
      );
    }

    this.server = await listen(app, this.options.port, this.options.host);
    this.started = true;
  }

  public async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = null;
    this.started = false;

    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

export function createGatewayServer(options: GatewayServerOptions): GatewayServer {
  return new GatewayServer(options);
}

async function loadA2AServerModules(): Promise<RuntimeA2AServerModules> {
  const [sdk, server, expressServer, expressModule] = await Promise.all([
    import("@a2a-js/sdk") as Promise<Record<string, unknown>>,
    import("@a2a-js/sdk/server") as Promise<Record<string, unknown>>,
    import("@a2a-js/sdk/server/express") as Promise<Record<string, unknown>>,
    import("express") as Promise<Record<string, unknown>>,
  ]).catch((error: unknown) => {
    throw new Error(
      `A2AGatewayAdapter requires optional dependency @a2a-js/sdk and express. (${error instanceof Error ? error.message : String(error)})`,
    );
  });

  const createExpressApp =
    (expressModule.default as ExpressFactory | undefined) ??
    (expressModule as unknown as ExpressFactory);

  const AGENT_CARD_PATH = asNonEmptyString(sdk.AGENT_CARD_PATH) ?? ".well-known/agent-card.json";
  const DefaultRequestHandler =
    server.DefaultRequestHandler as RuntimeA2AServerModules["DefaultRequestHandler"];
  const InMemoryTaskStore =
    server.InMemoryTaskStore as RuntimeA2AServerModules["InMemoryTaskStore"];
  const UserBuilder = expressServer.UserBuilder as RuntimeA2AServerModules["UserBuilder"];
  const agentCardHandler =
    expressServer.agentCardHandler as RuntimeA2AServerModules["agentCardHandler"];
  const jsonRpcHandler =
    expressServer.jsonRpcHandler as RuntimeA2AServerModules["jsonRpcHandler"];
  const restHandler =
    expressServer.restHandler as RuntimeA2AServerModules["restHandler"];

  if (
    !DefaultRequestHandler ||
    !InMemoryTaskStore ||
    !UserBuilder ||
    typeof agentCardHandler !== "function" ||
    typeof jsonRpcHandler !== "function" ||
    typeof restHandler !== "function" ||
    typeof createExpressApp !== "function" ||
    typeof createExpressApp.json !== "function"
  ) {
    throw new Error(
      "Failed to initialize A2A gateway server: missing required exports from @a2a-js/sdk/server or @a2a-js/sdk/server/express.",
    );
  }

  return {
    AGENT_CARD_PATH,
    DefaultRequestHandler,
    InMemoryTaskStore,
    UserBuilder,
    agentCardHandler,
    jsonRpcHandler,
    restHandler,
    createExpressApp,
  };
}

function buildAgentCard(peer: GatewayPeer, gatewayUrl: string): Record<string, unknown> {
  const url = `${gatewayUrl}/agents/${peer.slug}`;
  return {
    name: peer.name,
    description: peer.description,
    protocolVersion: "0.3.0",
    version: "1.0.0",
    url,
    preferredTransport: "JSONRPC",
    additionalInterfaces: [
      {
        transport: "JSONRPC",
        url,
      },
      {
        transport: "HTTP+JSON",
        url: `${url}/v1`,
      },
    ],
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    skills: [
      {
        id: "default",
        name: peer.name,
        description: peer.description,
        tags: ["thenvoi", "gateway"],
      },
    ],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
  };
}

function asA2AMessage(
  value: unknown,
  fallbackContextId: string,
  fallbackTaskId: string,
): GatewayRequest["message"] {
  if (!value || typeof value !== "object") {
    return {
      kind: "message",
      messageId: randomUUID(),
      role: "user",
      contextId: fallbackContextId,
      taskId: fallbackTaskId,
      parts: [],
    };
  }

  const raw = value as Record<string, unknown>;
  const rawParts = Array.isArray(raw.parts) ? raw.parts : [];
  const parts: GatewayMessagePart[] = [];
  for (const part of rawParts) {
    if (!part || typeof part !== "object") {
      continue;
    }

    const candidate = part as Record<string, unknown>;
    parts.push({
      kind: asNonEmptyString(candidate.kind) ?? undefined,
      text: asNonEmptyString(candidate.text) ?? undefined,
      root:
        candidate.root && typeof candidate.root === "object"
          ? {
              text: asNonEmptyString((candidate.root as Record<string, unknown>).text) ?? undefined,
            }
          : undefined,
    });
  }

  return {
    kind: "message",
    messageId: asNonEmptyString(raw.messageId) ?? randomUUID(),
    role: asNonEmptyString(raw.role) === "agent" ? "agent" : "user",
    contextId: asNonEmptyString(raw.contextId) ?? fallbackContextId,
    taskId: asNonEmptyString(raw.taskId) ?? fallbackTaskId,
    parts,
  };
}

function listen(
  app: ExpressAppLike,
  port: number,
  host: string,
): Promise<HttpServer> {
  return new Promise<HttpServer>((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server));
    server.once("error", reject);
  });
}
