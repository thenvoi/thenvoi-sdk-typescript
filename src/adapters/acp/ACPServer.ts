import { Readable, Writable } from "node:stream";

import type {
  Agent,
  AgentSideConnection,
  AuthenticateRequest,
  AuthenticateResponse,
  ForkSessionRequest,
  ForkSessionResponse,
  Implementation,
  InitializeRequest,
  InitializeResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  PromptRequest,
  PromptResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
  SetSessionModelRequest,
  SetSessionModelResponse,
  SessionMode,
  Stream,
} from "@agentclientprotocol/sdk";
import {
  AgentSideConnection as ACPAgentSideConnection,
  PROTOCOL_VERSION,
  RequestError,
  ndJsonStream,
} from "@agentclientprotocol/sdk";

import { ThenvoiACPServerAdapter } from "./ThenvoiACPServerAdapter";

export interface ACPServerOptions {
  modes?: SessionMode[];
  authMethods?: InitializeResponse["authMethods"];
  agentInfo?: Partial<Implementation>;
}

export class ACPServer implements Agent {
  private readonly adapter: ThenvoiACPServerAdapter
  private readonly authMethods: InitializeResponse["authMethods"]
  private readonly agentInfo: Partial<Implementation>
  private connection: AgentSideConnection | null = null

  public constructor(
    adapter: ThenvoiACPServerAdapter,
    options?: ACPServerOptions,
  ) {
    this.adapter = adapter
    if (options?.modes?.length) {
      this.adapter.setSessionModes([...options.modes])
    }
    this.authMethods = options?.authMethods ?? [{
      id: "api_key",
      name: "API Key",
      description: "Authenticate with THENVOI_API_KEY.",
    }]
    this.agentInfo = options?.agentInfo ?? {}
  }

  public connectStream(stream: Stream): AgentSideConnection {
    if (this.connection && !this.connection.signal.aborted) {
      return this.connection
    }

    this.connection = new ACPAgentSideConnection((connection) => {
      this.adapter.bindConnection(connection)
      return this
    }, stream)

    void this.connection.closed.finally(() => {
      if (this.connection?.signal.aborted) {
        this.adapter.bindConnection(null)
      }
    })

    return this.connection
  }

  public connectStdio(
    options?: {
      stdin?: NodeJS.ReadableStream;
      stdout?: NodeJS.WritableStream;
    },
  ): AgentSideConnection {
    const stdin = options?.stdin ?? process.stdin
    const stdout = options?.stdout ?? process.stdout
    return this.connectStream(
      ndJsonStream(
        Writable.toWeb(stdout as Writable) as unknown as WritableStream<Uint8Array>,
        Readable.toWeb(stdin as Readable) as unknown as ReadableStream<Uint8Array>,
      ),
    )
  }

  public get closed(): Promise<void> {
    return this.connection?.closed ?? Promise.resolve()
  }

  public async initialize(
    params: InitializeRequest,
  ): Promise<InitializeResponse> {
    return {
      protocolVersion: params.protocolVersion === PROTOCOL_VERSION
        ? params.protocolVersion
        : PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: true,
        },
        sessionCapabilities: {
          list: {},
          resume: {},
          fork: {},
          close: {},
        },
      },
      agentInfo: {
        name: this.agentInfo.name ?? "thenvoi-agent",
        title: this.agentInfo.title ?? this.adapter["agentName"] ?? "Thenvoi Agent",
        version: this.agentInfo.version ?? "0.1.0",
      },
      authMethods: this.authMethods,
    }
  }

  public async newSession(
    params: import("@agentclientprotocol/sdk").NewSessionRequest,
  ): Promise<import("@agentclientprotocol/sdk").NewSessionResponse> {
    const sessionId = await this.adapter.createSession({
      cwd: params.cwd,
      mcpServers: params.mcpServers,
    })

    return {
      sessionId,
      modes: this.adapter.getModeState(sessionId),
    }
  }

  public async loadSession(
    params: LoadSessionRequest,
  ): Promise<LoadSessionResponse> {
    if (!this.adapter.hasSession(params.sessionId)) {
      throw RequestError.resourceNotFound(params.sessionId)
    }

    this.adapter.updateSessionContext(params.sessionId, {
      cwd: params.cwd,
      mcpServers: params.mcpServers,
    })

    return {
      modes: this.adapter.getModeState(params.sessionId),
    }
  }

  public async listSessions(
    params: ListSessionsRequest,
  ): Promise<ListSessionsResponse> {
    const sessions = this.adapter.getSessionIds()
      .filter((sessionId) => !params.cwd || this.adapter.getSessionCwd(sessionId) === params.cwd)
      .map((sessionId) => ({
        sessionId,
        cwd: this.adapter.getSessionCwd(sessionId),
      }))

    return { sessions }
  }

  public async unstable_forkSession(
    params: ForkSessionRequest,
  ): Promise<ForkSessionResponse> {
    if (!this.adapter.hasSession(params.sessionId)) {
      throw RequestError.resourceNotFound(params.sessionId)
    }

    const sessionId = await this.adapter.createSession({
      cwd: params.cwd,
      mcpServers: params.mcpServers,
    })

    return {
      sessionId,
    }
  }

  public async unstable_resumeSession(
    params: ResumeSessionRequest,
  ): Promise<ResumeSessionResponse> {
    if (!this.adapter.hasSession(params.sessionId)) {
      throw RequestError.resourceNotFound(params.sessionId)
    }

    this.adapter.updateSessionContext(params.sessionId, {
      cwd: params.cwd,
      mcpServers: params.mcpServers,
    })

    return {
      modes: this.adapter.getModeState(params.sessionId),
    }
  }

  public async unstable_closeSession(
    params: import("@agentclientprotocol/sdk").CloseSessionRequest,
  ): Promise<import("@agentclientprotocol/sdk").CloseSessionResponse> {
    await this.adapter.closeSession(params.sessionId)
    return {}
  }

  public async setSessionMode(
    params: SetSessionModeRequest,
  ): Promise<SetSessionModeResponse> {
    if (!this.adapter.hasSession(params.sessionId)) {
      throw RequestError.resourceNotFound(params.sessionId)
    }

    this.adapter.setSessionMode(params.sessionId, params.modeId)
    return {}
  }

  public async unstable_setSessionModel(
    params: SetSessionModelRequest,
  ): Promise<SetSessionModelResponse> {
    if (!this.adapter.hasSession(params.sessionId)) {
      throw RequestError.resourceNotFound(params.sessionId)
    }

    this.adapter.setSessionModel(params.sessionId, params.modelId)
    return {}
  }

  public async setSessionConfigOption(
    _params: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse> {
    return {
      configOptions: [],
    }
  }

  public async authenticate(
    params: AuthenticateRequest,
  ): Promise<AuthenticateResponse> {
    if (params.methodId !== "api_key" && params.methodId !== "cursor_login") {
      throw RequestError.authRequired(undefined, `Unsupported auth method: ${params.methodId}`)
    }

    const ok = await this.adapter.verifyCredentials()
    if (!ok) {
      throw RequestError.authRequired(undefined, "Authentication failed")
    }

    return {}
  }

  public async prompt(
    params: PromptRequest,
  ): Promise<PromptResponse> {
    const text = extractPromptText(params.prompt)
    await this.adapter.handlePrompt(params.sessionId, text)
    return {
      stopReason: "end_turn",
    }
  }

  public async cancel(
    params: import("@agentclientprotocol/sdk").CancelNotification,
  ): Promise<void> {
    await this.adapter.cancelPrompt(params.sessionId)
  }

  public async extMethod(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (method === "cursor/ask_question") {
      const options = Array.isArray(params.options) ? params.options : []
      const first = options.find((option) => !!option && typeof option === "object") as Record<string, unknown> | undefined
      if (!first) {
        return {
          outcome: {
            type: "cancelled",
          },
        }
      }

      return {
        outcome: {
          type: "selected",
          optionId: String(first.optionId ?? first.id ?? "0"),
        },
      }
    }

    if (method === "cursor/create_plan") {
      return {
        outcome: {
          type: "approved",
        },
      }
    }

    return {
      error: `Unknown extension method: ${method}`,
    }
  }

  public async extNotification(
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const sessionId = typeof params.sessionId === "string"
      ? params.sessionId
      : (typeof params.session_id === "string" ? params.session_id : null)
    if (!sessionId || !this.adapter.hasSession(sessionId)) {
      return
    }

    const connection = this.adapter.getConnection()
    if (!connection) {
      return
    }

    if (method === "cursor/update_todos") {
      const todos = Array.isArray(params.todos) ? params.todos : []
      const text = todos
        .filter((todo): todo is Record<string, unknown> => !!todo && typeof todo === "object")
        .map((todo) => `- [${todo.completed === true ? "x" : " "}] ${String(todo.content ?? "")}`)
        .join("\n")

      if (text.length > 0) {
        await connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text,
            },
          },
        })
      }
      return
    }

    if (method === "cursor/task" && typeof params.result === "string" && params.result.length > 0) {
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `[Task completed] ${params.result}`,
          },
        },
      })
    }
  }
}

function extractPromptText(
  prompt: PromptRequest["prompt"],
): string {
  const parts: string[] = []

  for (const block of prompt) {
    if (block.type === "text") {
      parts.push(block.text)
      continue
    }

    if (block.type === "image") {
      parts.push(block.uri ? `[Image: ${block.uri}]` : "[Image]")
      continue
    }

    if (block.type === "audio") {
      parts.push("[Audio]")
      continue
    }

    if (block.type === "resource_link") {
      parts.push(`[Resource: ${block.title ?? block.name ?? block.uri}]`)
      continue
    }

    if (block.type === "resource") {
      const resource = block.resource
      if ("text" in resource && typeof resource.text === "string") {
        parts.push(resource.text)
      } else {
        parts.push(`[Resource: ${resource.uri ?? "embedded"}]`)
      }
    }
  }

  return parts.join("\n").trim()
}
