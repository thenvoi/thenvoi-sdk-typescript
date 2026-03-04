import { Agent, CodexAdapter, type CodexAdapterConfig, loadAgentConfig, isDirectExecution } from "../../src/index";

interface CodexExampleOptions {
  model?: string;
  cwd?: string;
  approvalPolicy?: CodexAdapterConfig["approvalPolicy"];
  sandboxMode?: CodexAdapterConfig["sandboxMode"];
  reasoningEffort?: CodexAdapterConfig["reasoningEffort"];
}

export function createCodexAgent(
  options: CodexExampleOptions = {},
  overrides?: { agentId?: string; apiKey?: string },
): Agent {
  const adapter = new CodexAdapter({
    config: {
      model: options.model,
      cwd: options.cwd,
      approvalPolicy: options.approvalPolicy ?? "never",
      sandboxMode: options.sandboxMode ?? "workspace-write",
      reasoningEffort: options.reasoningEffort,
      enableExecutionReporting: true,
      emitThoughtEvents: true,
      enableLocalCommands: true,
    },
  });

  return Agent.create({
    adapter,
    agentId: overrides?.agentId ?? "codex-agent",
    apiKey: overrides?.apiKey ?? "api-key",
  });
}

if (isDirectExecution(import.meta.url)) {
  const config = loadAgentConfig("codex_agent");
  void createCodexAgent({}, config).run();
}
