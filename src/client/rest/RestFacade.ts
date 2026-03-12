import { UnsupportedFeatureError } from "../../core/errors";
import type { Logger } from "../../core/logger";
import { NoopLogger } from "../../core/logger";
import type {
  AddContactArgs,
  ContactRecord,
  ContactRequestsResult,
  ListContactRequestsArgs,
  ListContactsArgs,
  ListMemoriesArgs,
  MemoryRecord,
  MetadataMap,
  PeerRecord,
  RemoveContactArgs,
  RespondContactRequestArgs,
  StoreMemoryArgs,
  ToolOperationResult,
} from "../../contracts/dtos";
import { fetchPaginated, normalizePaginationMetadata, type PaginationOptions } from "./pagination";
import { normalizeContactRequestsResult } from "./responseNormalization";
import type {
  AgentIdentity,
  ChatParticipant,
  PaginatedResponse,
  PlatformChatMessage,
  RestApi,
} from "./types";
import type { RestRequestOptions } from "./requestOptions";

export { FernRestAdapter } from "./FernRestAdapter";

interface RestFacadeOptions {
  api: RestApi;
  logger?: Logger;
}

type ListAllChatsOptions = PaginationOptions;

type RequiredForwardOperation =
  | "getAgentMe"
  | "createChatMessage"
  | "createChatEvent"
  | "createChat"
  | "listChatParticipants"
  | "addChatParticipant"
  | "removeChatParticipant"
  | "markMessageProcessing"
  | "markMessageProcessed"
  | "markMessageFailed";

const REQUIRED_FORWARD_OPERATIONS: RequiredForwardOperation[] = [
  "getAgentMe",
  "createChatMessage",
  "createChatEvent",
  "createChat",
  "listChatParticipants",
  "addChatParticipant",
  "removeChatParticipant",
  "markMessageProcessing",
  "markMessageProcessed",
  "markMessageFailed",
];

type OptionalPassthroughOperation =
  | "listChats"
  | "getChatContext"
  | "listMessages"
  | "getNextMessage"
  | "addContact"
  | "removeContact"
  | "respondContactRequest"
  | "storeMemory"
  | "getMemory"
  | "supersedeMemory"
  | "archiveMemory";

const OPTIONAL_PASSTHROUGH_OPERATIONS: OptionalPassthroughOperation[] = [
  "listChats",
  "getChatContext",
  "listMessages",
  "getNextMessage",
  "addContact",
  "removeContact",
  "respondContactRequest",
  "storeMemory",
  "getMemory",
  "supersedeMemory",
  "archiveMemory",
];

const OPTIONAL_UNSUPPORTED_MESSAGES: Record<OptionalPassthroughOperation, string> = {
  listChats: "Chat listing is not available in current REST adapter",
  getChatContext: "Context hydration is not available in current REST adapter",
  listMessages: "Message queue listing is not available in current REST adapter",
  getNextMessage: "Message queue next-item lookup is not available in current REST adapter",
  addContact: "Contact creation is not available in current REST adapter",
  removeContact: "Contact removal is not available in current REST adapter",
  respondContactRequest: "Contact request responses are not available in current REST adapter",
  storeMemory: "Memory creation is not available in current REST adapter",
  getMemory: "Memory lookup is not available in current REST adapter",
  supersedeMemory: "Memory supersede is not available in current REST adapter",
  archiveMemory: "Memory archive is not available in current REST adapter",
};

export class RestFacade implements RestApi {
  private readonly api: RestApi;
  private readonly logger: Logger;

  public constructor(options: RestFacadeOptions) {
    this.api = options.api;
    this.logger = options.logger ?? new NoopLogger();

    for (const operation of REQUIRED_FORWARD_OPERATIONS) {
      this.installRequiredForwarder(operation);
    }

    for (const operation of OPTIONAL_PASSTHROUGH_OPERATIONS) {
      this.installOptionalPassthroughForwarder(operation, OPTIONAL_UNSUPPORTED_MESSAGES[operation]);
    }

    this.installNormalizedForwarders();
  }

  public async listAllChats(
    options?: ListAllChatsOptions,
    requestOptions?: RestRequestOptions,
  ): Promise<MetadataMap[]> {
    return fetchPaginated({
      fetchPage: ({ page, pageSize }) => this.callOptional(
        "listChats",
        OPTIONAL_UNSUPPORTED_MESSAGES.listChats,
        (method) => method({ page, pageSize }, requestOptions),
        { page, pageSize },
      ),
      pageSize: options?.pageSize,
      maxPages: options?.maxPages,
      strategy: options?.strategy,
      metadataValidation: options?.metadataValidation,
    });
  }

  private installRequiredForwarder<Op extends RequiredForwardOperation>(operation: Op): void {
    const bound = ((...args: unknown[]) => this.forward(
      operation,
      () => {
        const method = this.api[operation] as (...innerArgs: unknown[]) => Promise<unknown>;
        return method.apply(this.api, args);
      },
      extractForwardMetadata(operation, args),
    )) as RestApi[Op];

    (this as Record<Op, RestApi[Op]>)[operation] = bound;
  }

  private installOptionalPassthroughForwarder<Op extends OptionalPassthroughOperation>(
    operation: Op,
    unsupportedMessage: string,
  ): void {
    const bound = ((...args: unknown[]) => this.callOptional(
      operation,
      unsupportedMessage,
      (method) => (method as (...innerArgs: unknown[]) => Promise<unknown>)(...args),
      extractForwardMetadata(operation, args),
    )) as NonNullable<RestApi[Op]>;

    (this as Record<Op, NonNullable<RestApi[Op]>>)[operation] = bound;
  }

  private installNormalizedForwarders(): void {
    this.listContacts = ((request: ListContactsArgs, options?: RestRequestOptions) => this.callOptional(
      "listContacts",
      "Contact listing is not available in current REST adapter",
      async (method) => {
        const response = await method(request, options);
        return {
          data: response.data ?? [],
          metadata: normalizePaginationMetadata(response.metadata),
        };
      },
      request,
    )) as NonNullable<RestApi["listContacts"]>;

    this.listMemories = ((request: ListMemoriesArgs, options?: RestRequestOptions) => this.callOptional(
      "listMemories",
      "Memory listing is not available in current REST adapter",
      async (method) => {
        const response = await method(request, options);
        return {
          data: response.data ?? [],
          metadata: normalizePaginationMetadata(response.metadata),
        };
      },
      request,
    )) as NonNullable<RestApi["listMemories"]>;

    this.listPeers = ((
      request: { page: number; pageSize: number; notInChat: string },
      options?: RestRequestOptions,
    ) => this.callOptional(
      "listPeers",
      "Peer listing is not available in current REST adapter",
      async (method) => {
        const response = await method(request, options);
        return {
          data: response.data,
          metadata: normalizePaginationMetadata(response.metadata),
        };
      },
      request,
    )) as NonNullable<RestApi["listPeers"]>;

    this.listContactRequests = ((request: ListContactRequestsArgs, options?: RestRequestOptions) => this.callOptional(
      "listContactRequests",
      "Contact request listing is not available in current REST adapter",
      async (method) => normalizeContactRequestsResult(await method(request, options)),
      request,
    )) as NonNullable<RestApi["listContactRequests"]>;
  }

  private callOptional<Op extends keyof RestApi, Result>(
    operation: Op,
    unsupportedMessage: string,
    invoke: (method: NonNullable<RestApi[Op]>) => Promise<Result>,
    metadata?: object,
  ): Promise<Result> {
    const method = this.api[operation];
    if (!method) {
      throw new UnsupportedFeatureError(unsupportedMessage);
    }

    const boundMethod = ((...args: unknown[]) => (
      method as (...innerArgs: unknown[]) => Promise<unknown>
    ).apply(this.api, args)) as NonNullable<RestApi[Op]>;

    return this.forward(
      String(operation),
      () => invoke(boundMethod),
      metadata,
    );
  }

  private forward<T>(
    operation: string,
    call: () => Promise<T>,
    metadata?: object,
  ): Promise<T> {
    this.logger.debug(`REST ${operation}`, metadata as Record<string, unknown>);
    return call();
  }

  public getAgentMe!: RestApi["getAgentMe"];
  public createChatMessage!: RestApi["createChatMessage"];
  public createChatEvent!: RestApi["createChatEvent"];
  public createChat!: RestApi["createChat"];
  public listChatParticipants!: RestApi["listChatParticipants"];
  public addChatParticipant!: RestApi["addChatParticipant"];
  public removeChatParticipant!: RestApi["removeChatParticipant"];
  public markMessageProcessing!: RestApi["markMessageProcessing"];
  public markMessageProcessed!: RestApi["markMessageProcessed"];
  public markMessageFailed!: RestApi["markMessageFailed"];

  public listChats!: NonNullable<RestApi["listChats"]>;
  public getChatContext!: NonNullable<RestApi["getChatContext"]>;
  public listMessages!: NonNullable<RestApi["listMessages"]>;
  public getNextMessage!: NonNullable<RestApi["getNextMessage"]>;
  public addContact!: NonNullable<RestApi["addContact"]>;
  public removeContact!: NonNullable<RestApi["removeContact"]>;
  public respondContactRequest!: NonNullable<RestApi["respondContactRequest"]>;
  public storeMemory!: NonNullable<RestApi["storeMemory"]>;
  public getMemory!: NonNullable<RestApi["getMemory"]>;
  public supersedeMemory!: NonNullable<RestApi["supersedeMemory"]>;
  public archiveMemory!: NonNullable<RestApi["archiveMemory"]>;
  public listContacts!: NonNullable<RestApi["listContacts"]>;
  public listMemories!: NonNullable<RestApi["listMemories"]>;
  public listPeers!: NonNullable<RestApi["listPeers"]>;
  public listContactRequests!: NonNullable<RestApi["listContactRequests"]>;
}

function extractForwardMetadata(operation: string, args: unknown[]): Record<string, unknown> | undefined {
  switch (operation) {
    case "createChatMessage":
    case "createChatEvent":
    case "addChatParticipant":
    case "removeChatParticipant":
    case "markMessageProcessing":
    case "markMessageProcessed":
    case "markMessageFailed":
      return { chatId: args[0] };
    case "createChat":
      return { hasTaskId: Boolean(args[0]) };
    case "getMemory":
    case "supersedeMemory":
    case "archiveMemory":
      return { memoryId: args[0] };
    default:
      return undefined;
  }
}
