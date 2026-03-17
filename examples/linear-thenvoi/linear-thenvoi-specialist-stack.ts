import {
  isDirectExecution,
  loadAgentConfig,
} from "../../src/index";
import { ConsoleLogger } from "../../src/core";
import {
  createLinearThenvoiPlannerAgent,
  createLinearThenvoiReviewerAgent,
  resolveSpecialistWorkspace,
} from "./linear-thenvoi-specialist-agent";

async function runSpecialistStack(): Promise<void> {
  const logger = new ConsoleLogger();

  const plannerConfig = loadAgentConfig(process.env.LINEAR_THENVOI_PLANNER_CONFIG_KEY?.trim() ?? "planner_agent");
  const reviewerConfig = loadAgentConfig(process.env.LINEAR_THENVOI_REVIEWER_CONFIG_KEY?.trim() ?? "reviewer_agent");

  const plannerWorkspace = resolveSpecialistWorkspace({
    cwd: process.env.LINEAR_THENVOI_PLANNER_CWD?.trim(),
    workspaceMode: process.env.LINEAR_THENVOI_PLANNER_WORKSPACE_MODE?.trim() === "configured"
      ? "configured"
      : "temp",
    workspacePrefix: process.env.LINEAR_THENVOI_PLANNER_WORKSPACE_PREFIX?.trim() ?? "thenvoi-linear-planner-",
  });
  const reviewerWorkspace = resolveSpecialistWorkspace({
    cwd: process.env.LINEAR_THENVOI_REVIEWER_CWD?.trim(),
    workspaceMode: process.env.LINEAR_THENVOI_REVIEWER_WORKSPACE_MODE?.trim() === "configured"
      ? "configured"
      : "temp",
    workspacePrefix: process.env.LINEAR_THENVOI_REVIEWER_WORKSPACE_PREFIX?.trim() ?? "thenvoi-linear-reviewer-",
  });

  logger.info("linear_thenvoi_specialists.starting", {
    plannerWorkspace,
    reviewerWorkspace,
  });

  const planner = createLinearThenvoiPlannerAgent({
    ...plannerConfig,
    cwd: plannerWorkspace,
    workspaceMode: "configured",
  });
  const reviewer = createLinearThenvoiReviewerAgent({
    ...reviewerConfig,
    cwd: reviewerWorkspace,
    workspaceMode: "configured",
  });

  await Promise.all([planner.start(), reviewer.start()]);

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void Promise.all([
      planner.stop(),
      reviewer.stop(),
    ]).finally(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (isDirectExecution(import.meta.url)) {
  void runSpecialistStack().catch((error) => {
    const logger = new ConsoleLogger();
    logger.error("linear_thenvoi_specialists.startup_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
