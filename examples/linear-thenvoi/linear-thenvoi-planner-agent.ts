import {
  isDirectExecution,
  loadAgentConfig,
} from "../../src/index";
import { createLinearThenvoiPlannerAgent } from "./linear-thenvoi-specialist-agent";

export { createLinearThenvoiPlannerAgent } from "./linear-thenvoi-specialist-agent";

if (isDirectExecution(import.meta.url)) {
  const config = loadAgentConfig(process.env.LINEAR_THENVOI_PLANNER_CONFIG_KEY?.trim() ?? "planner_agent");
  void createLinearThenvoiPlannerAgent({
    ...config,
    cwd: process.env.LINEAR_THENVOI_PLANNER_CWD?.trim(),
    workspaceMode: process.env.LINEAR_THENVOI_PLANNER_WORKSPACE_MODE?.trim() === "configured"
      ? "configured"
      : "temp",
    workspacePrefix: process.env.LINEAR_THENVOI_PLANNER_WORKSPACE_PREFIX?.trim() ?? "thenvoi-linear-planner-",
  }).run();
}
