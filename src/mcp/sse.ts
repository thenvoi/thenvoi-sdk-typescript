import type { AdapterToolsProtocol } from "../contracts/protocols";
import type {
  BuildRegistrationsOptions,
  McpToolRegistration,
} from "./registrations";
import {
  buildRoomScopedRegistrations,
  buildSingleContextRegistrations,
} from "./registrations";
import { buildZodShape } from "./zod";

export interface ThenvoiMcpSseServerOptions {
  tools: AdapterToolsProtocol | ((roomId: string) => AdapterToolsProtocol | undefined);
  name?: string;
  port?: number;
  enableMemoryTools?: boolean;
  enableContactTools?: boolean;
  additionalTools?: McpToolRegistration[];
}

interface SessionRecord {
  mcpServer: InstanceType<typeof import("@modelcontextprotocol/sdk/server/mcp.js").McpServer>;
  transport: import("@modelcontextprotocol/sdk/server/sse.js").SSEServerTransport;
}

const PORT_RANGE_START = 50000
const PORT_RANGE_END = 60000

export class ThenvoiMcpSseServer {
  private readonly options: ThenvoiMcpSseServerOptions
  private readonly registrations: McpToolRegistration[]
  private httpServer: import("node:http").Server | null = null
  private actualPort: number | null = null
  private readonly sessions = new Map<string, SessionRecord>()

  public constructor(options: ThenvoiMcpSseServerOptions) {
    this.options = options

    const regOptions: BuildRegistrationsOptions = {
      enableMemoryTools: options.enableMemoryTools,
      enableContactTools: options.enableContactTools,
      additionalTools: options.additionalTools,
    }

    if (typeof options.tools === "function") {
      this.registrations = buildRoomScopedRegistrations(options.tools, regOptions)
    } else {
      this.registrations = buildSingleContextRegistrations(options.tools, regOptions)
    }
  }

  public get port(): number | null {
    return this.actualPort
  }

  public get sseUrl(): string | null {
    if (this.actualPort === null) {
      return null
    }

    return `http://127.0.0.1:${this.actualPort}/sse`
  }

  public get toolNames(): string[] {
    return this.registrations.map((registration) => registration.name)
  }

  public async start(): Promise<void> {
    if (this.httpServer) {
      return
    }

    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js")
    const { SSEServerTransport } = await import("@modelcontextprotocol/sdk/server/sse.js")
    const expressModule = await import("express")
    const express = expressModule.default ?? expressModule
    const http = await import("node:http")
    const { z } = await import("zod")

    const app = express()
    app.use(express.json())
    app.get("/healthz", (_req, res) => {
      res.json({ status: "ok" })
    })

    app.get("/sse", async (_req, res) => {
      const transport = new SSEServerTransport("/messages", res)
      const mcpServer = new McpServer({
        name: this.options.name ?? "thenvoi",
        version: "1.0.0",
      })
      registerTools(mcpServer, z, this.registrations)
      await mcpServer.connect(transport)

      const sessionId = transport.sessionId
      this.sessions.set(sessionId, {
        mcpServer,
        transport,
      })

      res.on("close", () => {
        this.sessions.delete(sessionId)
      })
    })

    app.post("/messages", async (req, res) => {
      const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : null
      if (!sessionId) {
        res.status(400).send("Missing sessionId")
        return
      }

      const session = this.sessions.get(sessionId)
      if (!session) {
        res.status(404).send("Session not found")
        return
      }

      await session.transport.handlePostMessage(req, res, req.body)
    })

    const port = this.options.port ?? await findAvailablePort(http)
    await new Promise<void>((resolve, reject) => {
      const server = http.createServer(app)
      server.on("error", reject)
      server.listen(port, "127.0.0.1", () => {
        this.httpServer = server
        this.actualPort = port
        resolve()
      })
    })
  }

  public async stop(): Promise<void> {
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(sessions.map(async (session) => {
      await session.transport.close()
    }))

    if (!this.httpServer) {
      return
    }

    const server = this.httpServer
    this.httpServer = null
    this.actualPort = null
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }
}

function registerTools(
  mcpServer: InstanceType<typeof import("@modelcontextprotocol/sdk/server/mcp.js").McpServer>,
  z: typeof import("zod").z,
  registrations: McpToolRegistration[],
): void {
  for (const registration of registrations) {
    const zodShape = buildZodShape(
      z,
      registration.inputSchema.properties,
      new Set(registration.inputSchema.required),
    )

    mcpServer.registerTool(
      registration.name,
      {
        description: registration.description,
        inputSchema: z.object(zodShape),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP SDK handler signature is complex; our McpToolResult is compatible
      async (args: Record<string, unknown>): Promise<any> => registration.execute(args),
    )
  }
}

async function findAvailablePort(http: typeof import("node:http")): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = PORT_RANGE_START + Math.floor(Math.random() * (PORT_RANGE_END - PORT_RANGE_START))
    if (await checkPort(http, port)) {
      return port
    }
  }

  return 0
}

function checkPort(http: typeof import("node:http"), port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = http.createServer()
    server.once("error", () => {
      resolve(false)
    })
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true))
    })
  })
}
