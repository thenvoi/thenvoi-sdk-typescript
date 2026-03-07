import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  Agent,
  ConsoleLogger,
  isDirectExecution,
  loadAgentConfig,
} from "../../src/index";
import { createLinearThenvoiSpecialistAgent } from "./linear-thenvoi-specialist-agent";

interface RoleAgentInstance {
  agent: Agent;
  cwd: string;
  roleName: string;
}

interface RoleAgentOptions {
  configKey: string;
  roleName: string;
  roleInstructions: string;
  workdirPrefix: string;
  cwd?: string;
  codexModel?: string;
}

export function createFreshSpecialistWorkdir(roleSlug: string): string {
  const baseDir = process.env.LINEAR_THENVOI_SPECIALIST_TMPDIR?.trim() || tmpdir();
  mkdirSync(baseDir, { recursive: true });
  const cwd = mkdtempSync(join(baseDir, `thenvoi-${roleSlug}-`));

  writeFileSync(
    resolve(cwd, "WORKSPACE.md"),
    [
      `# ${roleSlug} workspace`,
      "",
      "This directory was created for a Thenvoi Linear specialist agent.",
      "Treat it as an isolated working directory for the current task.",
      "",
      "You may create the minimal files needed to satisfy the room request.",
    ].join("\n"),
    "utf8",
  );

  return cwd;
}

export function createLinearThenvoiPlannerAgent(options?: {
  configKey?: string;
  cwd?: string;
  codexModel?: string;
}): RoleAgentInstance {
  return createRoleAgent({
    configKey: options?.configKey ?? process.env.LINEAR_THENVOI_PLANNER_CONFIG_KEY?.trim() ?? "planner_agent",
    roleName: "Planner Agent",
    roleInstructions: [
      "Turn rough requests into execution-ready plans.",
      "When asked to enrich a ticket, return a sharper problem statement, scope, constraints, acceptance criteria, and a short implementation checklist.",
      "Do not implement code unless the room explicitly asks for a concrete artifact.",
      "If the brief is underspecified, propose the missing details as assumptions instead of blocking the room.",
    ].join(" "),
    workdirPrefix: "planner",
    cwd: options?.cwd ?? process.env.LINEAR_THENVOI_PLANNER_CWD?.trim(),
    codexModel: options?.codexModel,
  });
}

export function createLinearThenvoiCoderAgent(options?: {
  configKey?: string;
  cwd?: string;
  codexModel?: string;
}): RoleAgentInstance {
  return createRoleAgent({
    configKey: options?.configKey ?? process.env.LINEAR_THENVOI_CODER_CONFIG_KEY?.trim() ?? "codex_agent",
    roleName: "Coder Agent",
    roleInstructions: [
      "Implement the requested deliverable in the current isolated workspace.",
      "Create the minimal set of files needed to make the solution concrete.",
      "When you finish, report exactly what you changed, what you verified, and what still needs review.",
      "If the room only asks for implementation planning, redirect that back to the planner instead of doing both jobs yourself.",
    ].join(" "),
    workdirPrefix: "coder",
    cwd: options?.cwd ?? process.env.LINEAR_THENVOI_CODER_CWD?.trim(),
    codexModel: options?.codexModel,
  });
}

function createRoleAgent(options: RoleAgentOptions): RoleAgentInstance {
  const config = loadAgentConfig(options.configKey);
  const cwd = options.cwd ?? createFreshSpecialistWorkdir(options.workdirPrefix);
  const agent = createLinearThenvoiSpecialistAgent({
    ...config,
    roleName: options.roleName,
    roleInstructions: options.roleInstructions,
    cwd,
    codexModel: options.codexModel,
  });

  return {
    agent,
    cwd,
    roleName: options.roleName,
  };
}

export async function runLinearThenvoiDemoSpecialists(): Promise<void> {
  const logger = new ConsoleLogger();
  const planner = createLinearThenvoiPlannerAgent();
  const coder = createLinearThenvoiCoderAgent();
  const agents = [planner, coder];

  await Promise.all(agents.map(async ({ agent }) => agent.start()));
  logger.info("linear_thenvoi_demo_specialists.started", {
    plannerCwd: planner.cwd,
    coderCwd: coder.cwd,
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("linear_thenvoi_demo_specialists.stopping", {});
    void Promise.allSettled(agents.map(async ({ agent }) => agent.stop(5_000)));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await Promise.all(agents.map(async ({ agent }) => agent.runForever()));
}

if (isDirectExecution(import.meta.url)) {
  void runLinearThenvoiDemoSpecialists().catch((error) => {
    const logger = new ConsoleLogger();
    logger.error("linear_thenvoi_demo_specialists.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
