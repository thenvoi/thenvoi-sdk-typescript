import {
  isDirectExecution,
  loadAgentConfig,
} from "../../src/index";
import { createLinearThenvoiCoderAgent } from "./linear-thenvoi-specialist-agent";

export { createLinearThenvoiCoderAgent } from "./linear-thenvoi-specialist-agent";

if (isDirectExecution(import.meta.url)) {
  const config = loadAgentConfig(process.env.LINEAR_THENVOI_CODER_CONFIG_KEY?.trim() ?? "codex_agent");
  void createLinearThenvoiCoderAgent({
    ...config,
    cwd: process.env.LINEAR_THENVOI_CODER_CWD?.trim(),
    workspaceMode: process.env.LINEAR_THENVOI_CODER_WORKSPACE_MODE?.trim() === "configured"
      ? "configured"
      : "temp",
    workspacePrefix: process.env.LINEAR_THENVOI_CODER_WORKSPACE_PREFIX?.trim() ?? "thenvoi-linear-coder-",
  }).run();
}
