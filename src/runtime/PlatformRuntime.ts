import type { FrameworkAdapter, Preprocessor } from "../contracts/protocols";
import type { ContactEvent, PlatformEvent } from "../platform/events";
import { ThenvoiLink, type ThenvoiLinkOptions } from "../platform/ThenvoiLink";
import { AgentRuntime } from "./AgentRuntime";
import type { AgentConfig, ContactEventConfig, SessionConfig } from "./types";
import type { PlatformMessage } from "./types";
import { RuntimeStateError, ValidationError } from "../core/errors";
import { DefaultPreprocessor } from "./preprocessing/DefaultPreprocessor";
import { ContactEventHandler } from "./ContactEventHandler";
import type { ExecutionContext } from "./ExecutionContext";

export interface PlatformRuntimeOptions {
  agentId: string;
  apiKey: string;
  wsUrl?: string;
  restUrl?: string;
  link?: ThenvoiLink;
  linkOptions?: Omit<ThenvoiLinkOptions, "agentId" | "apiKey">;
  preprocessor?: Preprocessor<PlatformEvent>;
  sessionConfig?: SessionConfig;
  contactConfig?: ContactEventConfig;
  agentConfig?: AgentConfig;
}

export class PlatformRuntime {
  private readonly _agentId: string;
  private readonly _apiKey: string;
  private readonly _wsUrl?: string;
  private readonly _restUrl?: string;
  private readonly preprocessor: Preprocessor<PlatformEvent>;
  private readonly sessionConfig?: SessionConfig;
  private readonly contactConfig?: ContactEventConfig;
  private readonly agentConfig?: AgentConfig;
  private readonly linkOptions?: Omit<ThenvoiLinkOptions, "agentId" | "apiKey">;

  private linkInstance?: ThenvoiLink;
  private initPromise: Promise<void> | null = null;
  private runtime?: AgentRuntime;
  private contactHandler?: ContactEventHandler;
  private _agentName = "";
  private _agentDescription = "";
  private contactsSubscribed = false;

  public constructor(options: PlatformRuntimeOptions) {
    if (!options.agentId || options.agentId.trim() === "") {
      throw new ValidationError(
        "agentId is required and must be a non-empty string. Use loadAgentConfig() to load credentials from agent_config.yaml.",
      );
    }

    if (!options.apiKey || options.apiKey.trim() === "") {
      throw new ValidationError(
        "apiKey is required and must be a non-empty string. Use loadAgentConfig() to load credentials from agent_config.yaml.",
      );
    }

    this._agentId = options.agentId;
    this._apiKey = options.apiKey;
    this._wsUrl = options.wsUrl;
    this._restUrl = options.restUrl;
    this.linkInstance = options.link;
    this.linkOptions = options.linkOptions;
    this.preprocessor = options.preprocessor ?? new DefaultPreprocessor();
    this.sessionConfig = options.sessionConfig;
    this.contactConfig = options.contactConfig;
    this.agentConfig = options.agentConfig;
  }

  public get link(): ThenvoiLink {
    if (!this.linkInstance) {
      throw new RuntimeStateError("Runtime is not initialized");
    }

    return this.linkInstance;
  }

  public get name(): string {
    return this._agentName;
  }

  public get agentId(): string {
    return this._agentId;
  }

  public get description(): string {
    return this._agentDescription;
  }

  public get contactConfiguration(): ContactEventConfig | undefined {
    return this.contactConfig;
  }

  public get isContactsSubscribed(): boolean {
    return this.contactsSubscribed;
  }

  public async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    try {
      await this.initPromise;
    } catch (error) {
      this.initPromise = null;
      throw error;
    }
  }

  private async doInitialize(): Promise<void> {
    if (!this.linkInstance) {
      this.linkInstance = new ThenvoiLink({
        ...this.linkOptions,
        agentId: this._agentId,
        apiKey: this._apiKey,
        wsUrl: this._wsUrl,
        restUrl: this._restUrl,
      });
    }

    const me = await this.link.rest.getAgentMe();
    this._agentName = me.name;
    this._agentDescription = me.description ?? "";
  }

  public async start(adapter: FrameworkAdapter): Promise<void> {
    await this.initialize();
    await adapter.onStarted(this._agentName, this._agentDescription);

    const strategy = this.contactConfig?.strategy ?? "disabled";
    if (strategy !== "disabled") {
      this.contactHandler = new ContactEventHandler({
        config: this.contactConfig ?? { strategy: "disabled" },
        rest: this.link.rest,
        onBroadcast: (message) => {
          const runtime = this.runtime;
          if (!runtime) return;
          for (const context of runtime.contextsList()) {
            context.injectSystemMessage(message);
          }
        },
        onHubEvent: async (roomId, event) => {
          const runtime = this.runtime;
          if (!runtime) return;
          await runtime.enqueueEvent(roomId, event);
        },
        onHubInit: async (roomId, systemPrompt) => {
          const runtime = this.runtime;
          if (!runtime) return;
          const context = runtime.getContext(roomId);
          if (context) {
            context.injectSystemMessage(systemPrompt);
          }
        },
      });
    }

    this.runtime = new AgentRuntime({
      link: this.link,
      agentId: this._agentId,
      sessionConfig: this.sessionConfig,
      agentConfig: this.agentConfig,
      onExecute: (context, event) => this.executeAdapter(context, event, adapter),
      onSessionCleanup: (roomId) => adapter.onCleanup(roomId),
      onContactEvent: (event) => this.handleContactEvent(event),
    });

    await this.runtime.start();
    this.contactsSubscribed = Boolean(this.link.capabilities.contacts);
  }

  public async stop(timeoutMs?: number): Promise<boolean> {
    if (!this.runtime) {
      return true;
    }

    const graceful = await this.runtime.stop(timeoutMs);
    this.runtime = undefined;
    this.contactHandler = undefined;
    this.contactsSubscribed = false;
    return graceful;
  }

  public async runForever(): Promise<void> {
    if (!this.runtime) {
      throw new RuntimeStateError("Runtime not started");
    }

    await this.runtime.waitUntilStopped();
  }

  public async bootstrapRoomMessage(roomId: string, message: PlatformMessage): Promise<void> {
    if (!this.runtime) {
      throw new RuntimeStateError("Runtime not started");
    }

    await this.runtime.bootstrapRoomMessage(roomId, message);
  }

  public async resetRoomSession(roomId: string, timeoutMs?: number): Promise<boolean> {
    if (!this.runtime) {
      throw new RuntimeStateError("Runtime not started");
    }

    return await this.runtime.resetRoomSession(roomId, timeoutMs);
  }

  private async executeAdapter(
    context: ExecutionContext,
    event: PlatformEvent,
    adapter: FrameworkAdapter,
  ): Promise<void> {
    const input = await this.preprocessor.process(context, event, this._agentId);
    if (!input) {
      return;
    }

    const messageId = String(input.message.id ?? "");
    const roomId = input.roomId;

    if (messageId) {
      await this.link.markProcessing(roomId, messageId);
    }

    try {
      await adapter.onEvent(input);
      if (messageId) {
        await this.link.markProcessed(roomId, messageId);
      }
    } catch (error) {
      const label = error instanceof Error ? error.message : String(error);
      if (messageId) {
        await this.link.markFailed(roomId, messageId, label);
      }
      throw error;
    }
  }

  private async handleContactEvent(event: ContactEvent): Promise<void> {
    if (this.contactHandler) {
      await this.contactHandler.handle(event);
      return;
    }

    // Legacy fallback: broadcast only
    if (!this.contactConfig?.broadcastChanges) {
      return;
    }

    const runtime = this.runtime;
    if (!runtime) {
      return;
    }

    const message = this.formatContactBroadcast(event);
    for (const context of runtime.contextsList()) {
      context.injectSystemMessage(message);
    }
  }

  private formatContactBroadcast(event: ContactEvent): string {
    switch (event.type) {
      case "contact_request_received":
        return `[System]: New contact request from ${event.payload.from_name} (${event.payload.from_handle}).`;
      case "contact_request_updated":
        return `[System]: Contact request ${event.payload.id} updated to ${event.payload.status}.`;
      case "contact_added":
        return `[System]: Contact added: ${event.payload.name} (${event.payload.handle}).`;
      case "contact_removed":
        return `[System]: Contact removed: ${event.payload.id}.`;
    }

    return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled contact event: ${JSON.stringify(value)}`);
}
