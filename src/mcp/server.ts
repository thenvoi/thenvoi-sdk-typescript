import type { AdapterToolsProtocol } from "../contracts/protocols";
import type {
  BuildRegistrationsOptions,
  McpToolRegistration,
} from "./registrations";
import {
  buildRoomScopedRegistrations,
  buildSingleContextRegistrations,
} from "./registrations";

export interface ThenvoiMcpServerOptions {
  /** Single tools instance (no room scoping) or a resolver function for room-scoped tools. */
  tools: AdapterToolsProtocol | ((roomId: string) => AdapterToolsProtocol | undefined);
  /** Server name advertised to MCP clients. */
  name?: string;
  /** Port to listen on. Defaults to auto-selecting from 50000-60000. */
  port?: number;
  /** Enable memory tools. */
  enableMemoryTools?: boolean;
  /** Enable contact tools. */
  enableContactTools?: boolean;
  /** Additional MCP tool registrations to expose alongside the built-in tools. */
  additionalTools?: McpToolRegistration[];
}

const PORT_RANGE_START = 50000;
const PORT_RANGE_END = 60000;

/**
 * Standalone MCP server that exposes Thenvoi agent tools over Streamable HTTP.
 *
 * Uses `@modelcontextprotocol/server` (optional peer dependency) and `express`.
 * Install with: `npm install @modelcontextprotocol/server express`
 */
export class ThenvoiMcpServer {
  private readonly options: ThenvoiMcpServerOptions;
  private readonly registrations: McpToolRegistration[];
  private httpServer: import("node:http").Server | null = null;
  private actualPort: number | null = null;

  public constructor(options: ThenvoiMcpServerOptions) {
    this.options = options;

    const regOptions: BuildRegistrationsOptions = {
      enableMemoryTools: options.enableMemoryTools,
      enableContactTools: options.enableContactTools,
      additionalTools: options.additionalTools,
    };

    if (typeof options.tools === "function") {
      this.registrations = buildRoomScopedRegistrations(options.tools, regOptions);
    } else {
      this.registrations = buildSingleContextRegistrations(options.tools, regOptions);
    }
  }

  /** Port the server is listening on. Null if not started. */
  public get port(): number | null {
    return this.actualPort;
  }

  /** MCP endpoint URL. Null if not started. */
  public get url(): string | null {
    if (this.actualPort === null) {
      return null;
    }
    return `http://127.0.0.1:${this.actualPort}/mcp`;
  }

  /** Tool names registered on this server. */
  public get toolNames(): string[] {
    return this.registrations.map((r) => r.name);
  }

  public async start(): Promise<void> {
    // Lazy imports — these are optional peer dependencies.
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
    const expressModule = await import("express");
    const express = expressModule.default ?? expressModule;
    const http = await import("node:http");
    const { z } = await import("zod");

    const serverName = this.options.name ?? "thenvoi";
    const mcpServer = new McpServer({ name: serverName, version: "1.0.0" });

    for (const reg of this.registrations) {
      const zodShape = buildZodShape(z, reg.inputSchema.properties, new Set(reg.inputSchema.required));

      mcpServer.registerTool(
        reg.name,
        {
          description: reg.description,
          inputSchema: z.object(zodShape),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP SDK handler signature is complex; our McpToolResult is compatible
        async (args: Record<string, unknown>): Promise<any> => reg.execute(args),
      );
    }

    const app = express();
    app.use(express.json());

    app.get("/healthz", (_req, res) => {
      res.json({ status: "ok" });
    });

    app.post("/mcp", async (req, res) => {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    const port = this.options.port ?? await findAvailablePort(http);

    return new Promise<void>((resolve, reject) => {
      const server = http.createServer(app);
      server.on("error", reject);
      server.listen(port, "127.0.0.1", () => {
        this.httpServer = server;
        this.actualPort = port;
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.httpServer) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.httpServer!.close((error) => {
        this.httpServer = null;
        this.actualPort = null;
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

function buildZodShape(
  z: typeof import("zod").z,
  properties: Record<string, unknown>,
  required: Set<string>,
): Record<string, import("zod").ZodTypeAny> {
  const shape: Record<string, import("zod").ZodTypeAny> = {};

  for (const [name, schema] of Object.entries(properties)) {
    const validator = jsonSchemaToZod(z, schema as Record<string, unknown>);
    shape[name] = required.has(name) ? validator : validator.optional();
  }

  return shape;
}

function jsonSchemaToZod(
  z: typeof import("zod").z,
  schema: Record<string, unknown>,
): import("zod").ZodTypeAny {
  const type = schema.type;

  if (type === "string") {
    if (Array.isArray(schema.enum) && schema.enum.every((v) => typeof v === "string")) {
      const values = schema.enum;
      if (values.length > 0) {
        return z.enum(values as [string, ...string[]]);
      }
    }
    return z.string();
  }

  if (type === "integer" || type === "number") {
    return z.number();
  }

  if (type === "boolean") {
    return z.boolean();
  }

  if (type === "array") {
    const itemSchema = schema.items;
    if (itemSchema && typeof itemSchema === "object") {
      return z.array(jsonSchemaToZod(z, itemSchema as Record<string, unknown>));
    }
    return z.array(z.unknown());
  }

  if (type === "object") {
    return z.record(z.string(), z.unknown());
  }

  return z.unknown();
}

async function findAvailablePort(http: typeof import("node:http")): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = PORT_RANGE_START + Math.floor(Math.random() * (PORT_RANGE_END - PORT_RANGE_START));
    const available = await checkPort(http, port);
    if (available) {
      return port;
    }
  }

  // Fallback: let the OS assign a port
  return 0;
}

function checkPort(http: typeof import("node:http"), port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}
