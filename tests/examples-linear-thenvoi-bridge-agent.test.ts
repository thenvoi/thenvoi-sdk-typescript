import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const agentCreateMock = vi.fn();
const codexAdapterMock = vi.fn();
const createLinearClientMock = vi.fn();
const createLinearToolsMock = vi.fn();
const createSqliteSessionRoomStoreMock = vi.fn();

vi.mock("../src/index", () => ({
  Agent: {
    create: agentCreateMock,
  },
  CodexAdapter: codexAdapterMock,
  loadAgentConfig: vi.fn(),
  isDirectExecution: vi.fn(() => false),
}));

vi.mock("../src/linear", () => ({
  createLinearClient: createLinearClientMock,
  createLinearTools: createLinearToolsMock,
  createSqliteSessionRoomStore: createSqliteSessionRoomStoreMock,
}));

describe("linear thenvoi bridge agent example", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.LINEAR_ACCESS_TOKEN;
    delete process.env.CODEX_MODEL;
    delete process.env.LINEAR_THENVOI_STATE_DB;

    createLinearClientMock.mockReturnValue({ kind: "linear-client" });
    createLinearToolsMock.mockReturnValue([{ name: "linear_post_response" }]);
    createSqliteSessionRoomStoreMock.mockReturnValue({ kind: "store" });
    codexAdapterMock.mockImplementation((args) => ({ kind: "codex-adapter", args }));
    agentCreateMock.mockReturnValue({ kind: "agent-instance" });
  });

  afterEach(() => {
    delete process.env.LINEAR_ACCESS_TOKEN;
    delete process.env.CODEX_MODEL;
    delete process.env.LINEAR_THENVOI_STATE_DB;
  });

  it("builds the bridge agent with the linear tools, codex adapter, and store defaults", async () => {
    process.env.LINEAR_ACCESS_TOKEN = "lin_api_env";
    process.env.CODEX_MODEL = "gpt-5-test";
    process.env.LINEAR_THENVOI_STATE_DB = ".tmp-bridge.sqlite";

    const module = await import("../examples/linear-thenvoi/linear-thenvoi-bridge-agent");
    const agent = module.createLinearThenvoiBridgeAgent();

    expect(agent).toEqual({ kind: "agent-instance" });
    expect(createSqliteSessionRoomStoreMock).toHaveBeenCalledWith(".tmp-bridge.sqlite");
    expect(createLinearClientMock).toHaveBeenCalledWith("lin_api_env");
    expect(createLinearToolsMock).toHaveBeenCalledWith({
      client: { kind: "linear-client" },
      store: { kind: "store" },
      enableElicitation: false,
    });

    expect(codexAdapterMock).toHaveBeenCalledWith({
      config: expect.objectContaining({
        model: "gpt-5-test",
        approvalPolicy: "never",
        sandboxMode: "workspace-write",
        enableExecutionReporting: true,
        emitThoughtEvents: true,
        customSection: expect.stringContaining("the first planner kickoff must happen in the room"),
      }),
      customTools: [{ name: "linear_post_response" }],
    });

    expect(agentCreateMock).toHaveBeenCalledWith({
      adapter: expect.objectContaining({ kind: "codex-adapter" }),
      wsUrl: undefined,
      restUrl: undefined,
      linkOptions: undefined,
      logger: undefined,
      sessionConfig: undefined,
      config: {
        agentId: "agent-linear-thenvoi-bridge",
        apiKey: "api-key",
      },
      agentConfig: {
        autoSubscribeExistingRooms: false,
      },
      identity: {
        name: "Thenvoi Linear Bridge",
        description: "Linear bridge agent coordinating Thenvoi specialists",
      },
    });
  });

  it("honors explicit overrides without touching env-backed defaults", async () => {
    const explicitStore = { kind: "explicit-store" };
    const explicitClient = { kind: "explicit-linear-client" };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    const module = await import("../examples/linear-thenvoi/linear-thenvoi-bridge-agent");
    module.createLinearThenvoiBridgeAgent({
      agentId: "bridge-1",
      apiKey: "thnv_api",
      wsUrl: "wss://thenvoi.example/socket",
      restUrl: "https://thenvoi.example",
      linearAccessToken: "lin_api_explicit",
      linearClient: explicitClient as never,
      stateDbPath: ".ignored.sqlite",
      store: explicitStore as never,
      codexModel: "gpt-5-prod",
      name: "Bridge Name",
      description: "Bridge Description",
      logger: logger as never,
      linkOptions: { capabilities: { contacts: true } },
      sessionConfig: { maxContextMessages: 12 },
    });

    expect(createSqliteSessionRoomStoreMock).not.toHaveBeenCalled();
    expect(createLinearClientMock).not.toHaveBeenCalled();
    expect(createLinearToolsMock).toHaveBeenCalledWith({
      client: explicitClient,
      store: explicitStore,
      enableElicitation: false,
    });
    expect(agentCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        wsUrl: "wss://thenvoi.example/socket",
        restUrl: "https://thenvoi.example",
        logger,
        linkOptions: { capabilities: { contacts: true } },
        sessionConfig: { maxContextMessages: 12 },
        config: {
          agentId: "bridge-1",
          apiKey: "thnv_api",
        },
        identity: {
          name: "Bridge Name",
          description: "Bridge Description",
        },
      }),
    );
  });

  it("keeps the prompt contract for async specialist planning", async () => {
    const module = await import("../examples/linear-thenvoi/linear-thenvoi-bridge-agent");
    const prompt = module.buildLinearThenvoiBridgePrompt();

    expect(prompt).toContain("if a planner is available, you must give the planner the first pass");
    expect(prompt).toContain("include all of this in that kickoff message");
    expect(prompt).toContain("Once you have sent a specialist kickoff message and the next step depends on their reply, end your turn.");
    expect(prompt).toContain("Do not claim a planner step or reviewer step is completed unless visible specialist output actually appeared in the room.");
  });
});
