import type {
  AdapterToolsProtocol,
  FrameworkAdapter,
  FrameworkAdapterInput,
  HistoryConverter,
  HistoryLike,
  PlatformMessageLike,
} from "../contracts/protocols";

export abstract class SimpleAdapter<H, TTools = AdapterToolsProtocol>
  implements FrameworkAdapter
{
  protected historyConverter?: HistoryConverter<H>;
  protected agentName = "";
  protected agentDescription = "";

  public constructor(options?: { historyConverter?: HistoryConverter<H> }) {
    this.historyConverter = options?.historyConverter;
  }

  public abstract onMessage(
    message: PlatformMessageLike,
    tools: TTools,
    history: H,
    participantsMessage: string | null,
    contactsMessage: string | null,
    context: {
      isSessionBootstrap: boolean;
      roomId: string;
    },
  ): Promise<void>;

  public async onCleanup(_roomId: string): Promise<void> {}

  public async onStarted(agentName: string, agentDescription: string): Promise<void> {
    this.agentName = agentName;
    this.agentDescription = agentDescription;
  }

  public async onEvent(input: FrameworkAdapterInput): Promise<void> {
    const history = this.convertHistory(input.history);
    await this.onMessage(
      input.message,
      input.tools as TTools,
      history,
      input.participantsMessage,
      input.contactsMessage,
      {
        isSessionBootstrap: input.isSessionBootstrap,
        roomId: input.roomId,
      },
    );
  }

  private convertHistory(provider: HistoryLike): H {
    if (!this.historyConverter) {
      return provider as H;
    }

    return provider.convert(this.historyConverter);
  }
}
