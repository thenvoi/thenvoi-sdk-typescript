import type { FrameworkAdapter, Preprocessor } from "../contracts/protocols";
import type { ContactEvent, PlatformEvent } from "../platform/events";
import { ThenvoiLink, type ThenvoiLinkOptions } from "../platform/ThenvoiLink";
import { AgentRuntime } from "./AgentRuntime";
import type { AgentConfig, ContactEventConfig, SessionConfig } from "./types";
import { RuntimeStateError } from "../core/errors";
import { DefaultPreprocessor } from "./preprocessing/DefaultPreprocessor";
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
  private runtime?: AgentRuntime;
  private _agentName = "";
  private _agentDescription = "";
  private contactsSubscribed = false;

  public constructor(options: PlatformRuntimeOptions) {
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

  public get agentName(): string {
    return this.name;
  }

  public get agentId(): string {
    return this._agentId;
  }

  public get description(): string {
    return this._agentDescription;
  }

  public get agentDescription(): string {
    return this.description;
  }

  public get contactConfiguration(): ContactEventConfig | undefined {
    return this.contactConfig;
  }

  public get isContactsSubscribed(): boolean {
    return this.contactsSubscribed;
  }

  public async initialize(): Promise<void> {
    if (!this.linkInstance) {
      if (!this.linkOptions?.restApi) {
        throw new RuntimeStateError("linkOptions.restApi is required to initialize PlatformRuntime");
      }

      this.linkInstance = new ThenvoiLink({
        ...this.linkOptions,
        agentId: this._agentId,
        apiKey: this._apiKey,
        wsUrl: this._wsUrl,
        restUrl: this._restUrl,
        restApi: this.linkOptions.restApi,
      });
    }

    const me = await this.link.rest.getAgentMe();
    this._agentName = me.name;
    this._agentDescription = me.description ?? "";
  }

  public async start(adapter: FrameworkAdapter): Promise<void> {
    await this.initialize();
    await adapter.onStarted(this._agentName, this._agentDescription);

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
    this.contactsSubscribed = false;
    return graceful;
  }

  public async runForever(): Promise<void> {
    if (!this.runtime) {
      throw new RuntimeStateError("Runtime not started");
    }

    await this.runtime.waitUntilStopped();
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

    await adapter.onEvent(input);
  }

  private async handleContactEvent(event: ContactEvent): Promise<void> {
    if (!this.contactConfig?.broadcastChanges) {
      return;
    }

    const runtime = this.runtime;
    if (!runtime) {
      return;
    }

    const message = this.formatContactBroadcast(event);
    for (const context of runtime.contextsList()) {
      context.setContactsMessage(message);
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
      default:
        return "[System]: Contact event received.";
    }
  }
}
