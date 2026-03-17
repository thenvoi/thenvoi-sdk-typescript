import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  Agent,
  isDirectExecution,
  loadAgentConfig,
} from "../../src/index";
import { ConsoleLogger } from "../../src/core";
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
  claudeModel?: string;
  mode?: "claude_sdk" | "codex" | "scripted";
}

const START_RETRY_ATTEMPTS = 4;
const START_RETRY_DELAY_MS = 2_000;

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
  claudeModel?: string;
}): RoleAgentInstance {
  return createRoleAgent({
    configKey: options?.configKey ?? process.env.LINEAR_THENVOI_PLANNER_CONFIG_KEY?.trim() ?? "planner_agent",
    roleName: "Claude Code Planner",
    roleInstructions: [
      "Turn rough requests into execution-ready implementation plans.",
      "When asked to enrich a ticket, return a sharper problem statement, scope, constraints, acceptance criteria, rollout sequence, and verification checklist.",
      "Do not implement code unless the room explicitly asks for a concrete artifact.",
      "If the brief is underspecified, propose the missing details as assumptions instead of blocking the room.",
    ].join(" "),
    workdirPrefix: "planner",
    cwd: options?.cwd ?? process.env.LINEAR_THENVOI_PLANNER_CWD?.trim(),
    codexModel: options?.codexModel,
    claudeModel: options?.claudeModel,
    mode: "claude_sdk",
  });
}

export function createLinearThenvoiReviewerAgent(options?: {
  configKey?: string;
  cwd?: string;
  codexModel?: string;
}): RoleAgentInstance {
  return createRoleAgent({
    configKey: options?.configKey ?? process.env.LINEAR_THENVOI_REVIEWER_CONFIG_KEY?.trim() ?? "reviewer_agent",
    roleName: "Codex Reviewer",
    roleInstructions: [
      "Review the planner's proposed implementation plan in the current isolated workspace.",
      "Tighten sequencing, assumptions, verification, and rollback notes before the bridge writes anything back to Linear.",
      "Report exactly what needs changing in the plan and what already looks solid.",
      "If the room only asks for implementation planning, stay in review mode rather than turning into the implementer.",
    ].join(" "),
    workdirPrefix: "reviewer",
    cwd: options?.cwd ?? process.env.LINEAR_THENVOI_REVIEWER_CWD?.trim(),
    codexModel: options?.codexModel,
    mode: "codex",
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
    claudeModel: options.claudeModel,
    mode: options.mode,
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
  const reviewer = createLinearThenvoiReviewerAgent();
  const agents = [planner, reviewer];

  for (const { agent, roleName } of agents) {
    await startAgentWithRetry({
      agent,
      roleName,
      logger,
    });
  }
  logger.info("linear_thenvoi_demo_specialists.started", {
    plannerCwd: planner.cwd,
    reviewerCwd: reviewer.cwd,
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

async function startAgentWithRetry(input: {
  agent: Agent;
  roleName: string;
  logger: ConsoleLogger;
}): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= START_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await input.agent.start();
      return;
    } catch (error) {
      lastError = error;
      if (!isRateLimitedStartupError(error) || attempt === START_RETRY_ATTEMPTS) {
        throw error;
      }

      input.logger.warn("linear_thenvoi_demo_specialists.start_retrying", {
        roleName: input.roleName,
        attempt,
        maxAttempts: START_RETRY_ATTEMPTS,
        delayMs: START_RETRY_DELAY_MS * attempt,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(START_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError;
}

function isRateLimitedStartupError(error: unknown): boolean {
  return error instanceof Error && /\b429\b/.test(error.message);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
