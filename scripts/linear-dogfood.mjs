#!/usr/bin/env node
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { LinearClient } from "@linear/sdk";

const ENRICHMENT_TIMEOUT_MS = 180_000;
const IMPLEMENTATION_TIMEOUT_MS = 480_000;
const FOLLOW_UP_TIMEOUT_MS = 180_000;
const STACK_READY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_500;

loadDotEnvLocal();

const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const runRoot = await mkdtemp(join(tmpdir(), `thenvoi-linear-dogfood-${runStamp}-`));
const logsDir = join(runRoot, "logs");
mkdirSync(logsDir, { recursive: true });

requireOneOfEnv(["LINEAR_ACCESS_TOKEN", "LINEAR_API_KEY"]);
requireEnv("LINEAR_WEBHOOK_SECRET");

if (!process.env.THENVOI_BRIDGE_API_KEY?.trim() && !process.env.THENVOI_API_KEY?.trim()) {
  throw new Error("Missing THENVOI_BRIDGE_API_KEY or THENVOI_API_KEY.");
}

const summary = {
  runRoot,
  startedAt: new Date().toISOString(),
  bridge: {},
  specialists: {},
  viewer: {},
  issue: {},
  workspaces: {},
  scenarios: [],
};

const shutdownCallbacks = [];
let shuttingDown = false;

process.on("SIGINT", () => {
  void shutdown("sigint", 130);
});
process.on("SIGTERM", () => {
  void shutdown("sigterm", 143);
});

try {
  const port = Number(process.env.PORT ?? "8787");
  const preflight = ensureBridgePortReady(port);
  if (preflight.killedPids.length > 0) {
    summary.preflight = {
      port,
      killedPids: preflight.killedPids,
    };
  }

  const bridgeProcess = startLoggedProcess({
    name: "bridge-stack",
    command: "pnpm",
    args: ["dev:linear"],
    logPath: join(logsDir, "bridge-stack.log"),
    extraEnv: {
      BRIDGE_LOG: join(logsDir, "bridge.log"),
      TUNNEL_LOG: join(logsDir, "tunnel.log"),
      LINEAR_THENVOI_ROOM_RESET_TIMEOUT_MS: process.env.LINEAR_THENVOI_ROOM_RESET_TIMEOUT_MS ?? "60000",
      LINEAR_THENVOI_DISPATCH_RETRY_LIMIT: process.env.LINEAR_THENVOI_DISPATCH_RETRY_LIMIT ?? "8",
      LINEAR_THENVOI_DISPATCH_RETRY_BASE_DELAY_MS: process.env.LINEAR_THENVOI_DISPATCH_RETRY_BASE_DELAY_MS ?? "2000",
    },
  });
  shutdownCallbacks.push(() => stopChildProcess(bridgeProcess.child, "SIGTERM"));

  const specialistsTmpRoot = join(runRoot, "specialist-workspaces");
  mkdirSync(specialistsTmpRoot, { recursive: true });

  const specialistsProcess = startLoggedProcess({
    name: "specialists",
    command: "pnpm",
    args: ["dev:linear:specialists"],
    logPath: join(logsDir, "specialists.log"),
    extraEnv: {
      LINEAR_THENVOI_SPECIALIST_TMPDIR: specialistsTmpRoot,
      LINEAR_THENVOI_SPECIALIST_TMP_ROOT: specialistsTmpRoot,
    },
  });
  shutdownCallbacks.push(() => stopChildProcess(specialistsProcess.child, "SIGTERM"));

  await waitForBridgeHealth(port, bridgeProcess);
  const specialistsReadyMatch = await waitForLoggedPattern(
    specialistsProcess,
    /linear_thenvoi_demo_specialists\.started/,
    STACK_READY_TIMEOUT_MS,
  );
  const webhookUrl = await resolveWebhookUrl(bridgeProcess);

  summary.bridge = {
    port,
    webhookUrl,
    stackLog: bridgeProcess.logPath,
    bridgeLog: join(logsDir, "bridge.log"),
    tunnelLog: join(logsDir, "tunnel.log"),
  };
  summary.specialists = {
    readyLine: specialistsReadyMatch.trim(),
    logPath: specialistsProcess.logPath,
    tmpRoot: specialistsTmpRoot,
  };

  const linear = createLinearClient(
    process.env.LINEAR_ACCESS_TOKEN ?? process.env.LINEAR_API_KEY ?? "",
  );
  const targetTeam = await resolveTargetTeam(linear);
  const viewer = await linear.viewer;
  if (!viewer?.id) {
    throw new Error("Unable to resolve the current Linear viewer for assignment.");
  }

  summary.viewer = {
    id: viewer.id,
    name: viewer.displayName ?? viewer.name ?? null,
  };

  const issue = await createIssue(linear, {
    teamId: targetTeam.id,
    title: `Dogfood: dog landing page ${runStamp}`,
    description: [
      "We want a landing page for the dog website.",
      "",
      "Use this ticket to dogfood the Thenvoi Linear bridge flow.",
      "Start by enriching the ticket into something implementation-ready.",
    ].join("\n"),
  });

  summary.issue = {
    id: issue.id,
    identifier: issue.identifier,
    url: issue.url,
    teamId: targetTeam.id,
    teamKey: targetTeam.key,
    teamName: targetTeam.name,
  };

  const initialSnapshot = await getIssueSnapshot(linear, issue.id);

  const enrichmentSession = await createIssueSession(linear, issue.id);
  const enrichmentTracePath = join(logsDir, `session-enrich_issue-${enrichmentSession.id}.jsonl`);
  const enrichmentResult = await waitForSessionOutcome(linear, enrichmentSession.id, {
    timeoutMs: ENRICHMENT_TIMEOUT_MS,
    tracePath: enrichmentTracePath,
  });
  const afterEnrichment = await getIssueSnapshot(linear, issue.id);
  const enrichmentChecks = evaluateEnrichment(initialSnapshot, afterEnrichment, enrichmentResult);
  summary.scenarios.push({
    name: "enrich_issue",
    sessionId: enrichmentSession.id,
    status: enrichmentResult.status,
    checks: enrichmentChecks,
    responsePreview: firstLine(enrichmentResult.responses[0] ?? null),
  });
  summary.sessionTraces = {
    ...(summary.sessionTraces ?? {}),
    enrich_issue: enrichmentTracePath,
  };
  assertScenarioPassed("enrich_issue", enrichmentChecks);

  const workflowStates = await listWorkflowStates(linear, issue.teamId);
  const inProgressState = pickInProgressState(workflowStates);
  const reviewState = pickReviewState(workflowStates);
  summary.workflowStates = {
    inProgressState,
    reviewState,
  };

  await updateIssueWorkflow(linear, issue.id, {
    stateId: inProgressState.id,
    assigneeId: viewer.id,
  });

  const implementationPrompt = await createIssueComment(
    linear,
    issue.id,
    [
      "Please implement the landing page now.",
      "",
      "Keep it concrete.",
      "Create the minimal runnable files needed for a dog adoption landing page and report what changed.",
    ].join("\n"),
  );

  const implementationSession = await createCommentSession(linear, implementationPrompt.id);
  const implementationTracePath = join(logsDir, `session-implement_from_comment-${implementationSession.id}.jsonl`);
  const implementationResult = await waitForSessionOutcome(linear, implementationSession.id, {
    timeoutMs: IMPLEMENTATION_TIMEOUT_MS,
    tracePath: implementationTracePath,
  });
  const afterImplementation = await getIssueSnapshot(linear, issue.id);
  summary.workspaces = summarizeWorkspaces(specialistsTmpRoot);
  const implementationChecks = evaluateImplementation(
    afterEnrichment,
    afterImplementation,
    implementationResult,
    reviewState,
  );
  summary.scenarios.push({
    name: "implement_from_comment",
    sessionId: implementationSession.id,
    status: implementationResult.status,
    checks: implementationChecks,
    responsePreview: firstLine(implementationResult.responses[0] ?? null),
  });
  summary.sessionTraces = {
    ...(summary.sessionTraces ?? {}),
    implement_from_comment: implementationTracePath,
  };
  assertScenarioPassed("implement_from_comment", implementationChecks);

  const followUpPrompt = await createIssueComment(
    linear,
    issue.id,
    [
      "If anything is still weak, tighten the hero copy and CTA.",
      "If not, reply with the smallest useful confirmation and do not churn the ticket.",
    ].join(" "),
  );

  const followUpSession = await createCommentSession(linear, followUpPrompt.id);
  const followUpTracePath = join(logsDir, `session-follow_up_comment-${followUpSession.id}.jsonl`);
  const followUpResult = await waitForSessionOutcome(linear, followUpSession.id, {
    timeoutMs: FOLLOW_UP_TIMEOUT_MS,
    tracePath: followUpTracePath,
  });
  const afterFollowUp = await getIssueSnapshot(linear, issue.id);
  const workspaceSummary = summarizeWorkspaces(specialistsTmpRoot);
  summary.workspaces = workspaceSummary;
  const followUpChecks = evaluateFollowUp(afterImplementation, afterFollowUp, followUpResult);
  summary.scenarios.push({
    name: "follow_up_comment",
    sessionId: followUpSession.id,
    status: followUpResult.status,
    checks: followUpChecks,
    responsePreview: firstLine(followUpResult.responses[0] ?? null),
  });
  summary.sessionTraces = {
    ...(summary.sessionTraces ?? {}),
    follow_up_comment: followUpTracePath,
  };
  assertScenarioPassed("follow_up_comment", followUpChecks);

  summary.finishedAt = new Date().toISOString();
  summary.finalIssueState = afterFollowUp.state;
  summary.finalCommentCount = afterFollowUp.commentCount;
  assertWorkspaceOutputs(workspaceSummary);

  writeSummary(runRoot, summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  await shutdown("success", 0);
} catch (error) {
  summary.finishedAt = new Date().toISOString();
  summary.error = error instanceof Error ? error.message : String(error);
  writeSummary(runRoot, summary);
  process.stderr.write(`Linear dogfood failed. See ${runRoot}\n`);
  process.stderr.write(`${summary.error}\n`);
  await shutdown("failure", 1);
}

function loadDotEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) {
    return;
  }

  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1);
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function requireOneOfEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }

  throw new Error(`Missing required environment variable: one of ${names.join(", ")}`);
}

function createLinearClient(token) {
  const trimmedToken = token.trim();
  if (trimmedToken.startsWith("lin_api_")) {
    return new LinearClient({
      apiKey: trimmedToken,
    });
  }

  return new LinearClient({
    accessToken: trimmedToken,
  });
}

function startLoggedProcess(input) {
  const logStream = createWriteStream(input.logPath, { flags: "a" });
  const child = spawn(input.command, input.args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...input.extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let buffer = "";
  const append = (chunk) => {
    const text = chunk.toString("utf8");
    logStream.write(text);
    buffer = `${buffer}${text}`.slice(-200_000);
  };

  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("exit", (code, signal) => {
    logStream.write(`\n[process-exit] code=${code ?? "null"} signal=${signal ?? "null"}\n`);
    logStream.end();
  });

  return {
    name: input.name,
    child,
    logPath: input.logPath,
    getBuffer: () => buffer,
  };
}

async function stopChildProcess(child, signal) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill(signal);
  await Promise.race([
    new Promise((resolveDone) => child.once("exit", resolveDone)),
    sleep(10_000),
  ]);

  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

async function waitForBridgeHealth(port, bridgeProcess) {
  const deadline = Date.now() + STACK_READY_TIMEOUT_MS;
  const url = `http://127.0.0.1:${port}/healthz`;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling
    }

    await sleep(1_000);
  }

  const excerpt = bridgeProcess?.getBuffer
    ? tailLines(bridgeProcess.getBuffer(), 40)
    : "";
  throw new Error(
    [
      `Bridge did not become healthy on ${url}.`,
      excerpt ? `Recent bridge-stack log lines:\n${excerpt}` : "",
    ].filter(Boolean).join("\n"),
  );
}

async function waitForLoggedPattern(processHandle, pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = processHandle.getBuffer().match(pattern);
    if (match?.[0]) {
      return match[0];
    }

    if (processHandle.child.exitCode !== null) {
      throw new Error(`${processHandle.name} exited before reaching readiness. See ${processHandle.logPath}`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for ${processHandle.name} readiness. See ${processHandle.logPath}`);
}

async function resolveWebhookUrl(bridgeProcess) {
  const configured = process.env.LINEAR_WEBHOOK_PUBLIC_URL?.trim();
  if (configured) {
    return configured;
  }

  const deadline = Date.now() + STACK_READY_TIMEOUT_MS;
  const linePattern = /Webhook URL:\s+(\S+)/;
  const quickTunnelPattern = /(https:\/\/[a-z0-9-]+\.trycloudflare\.com\/linear\/webhook)/i;

  while (Date.now() < deadline) {
    const buffer = bridgeProcess.getBuffer();
    const lineMatch = buffer.match(linePattern);
    if (lineMatch?.[1] && lineMatch[1] !== "unknown") {
      return lineMatch[1];
    }

    const quickTunnelMatch = buffer.match(quickTunnelPattern);
    if (quickTunnelMatch?.[1]) {
      return quickTunnelMatch[1];
    }

    if (bridgeProcess.child.exitCode !== null) {
      throw new Error(`bridge-stack exited before resolving a webhook URL. See ${bridgeProcess.logPath}`);
    }

    await sleep(500);
  }

  throw new Error(
    "Timed out resolving the public webhook URL. Set LINEAR_WEBHOOK_PUBLIC_URL or inspect the bridge-stack log.",
  );
}

async function resolveTargetTeam(client) {
  const configuredId = process.env.LINEAR_TEAM_ID?.trim();
  if (configuredId) {
    return {
      id: configuredId,
      key: process.env.LINEAR_TEAM_KEY?.trim() ?? null,
      name: process.env.LINEAR_TEAM_NAME?.trim() ?? null,
    };
  }

  const configuredKey = process.env.LINEAR_TEAM_KEY?.trim().toLowerCase();
  const configuredName = process.env.LINEAR_TEAM_NAME?.trim().toLowerCase();
  const connection = await client.teams();
  const teams = (connection.nodes ?? [])
    .map((team) => ({
      id: team.id,
      key: team.key ?? null,
      name: team.name ?? null,
    }))
    .filter((team) => Boolean(team.id));

  if (configuredKey) {
    const match = teams.find((team) => team.key?.toLowerCase() === configuredKey);
    if (match) {
      return match;
    }
  }

  if (configuredName) {
    const match = teams.find((team) => team.name?.toLowerCase() === configuredName);
    if (match) {
      return match;
    }
  }

  if (teams.length === 1) {
    return teams[0];
  }

  throw new Error(
    [
      "Unable to resolve a Linear target team.",
      "Set LINEAR_TEAM_ID, LINEAR_TEAM_KEY, or LINEAR_TEAM_NAME.",
      `Visible teams: ${teams.map((team) => `${team.key ?? "?"}:${team.name ?? team.id}`).join(", ") || "none"}`,
    ].join(" "),
  );
}

async function createIssue(client, input) {
  const payload = await client.createIssue(input);
  if (!payload.success) {
    throw new Error("Linear issue creation reported success=false.");
  }

  const issue = await payload.issue;
  if (!issue?.id) {
    throw new Error("Linear issue creation did not return an issue.");
  }

  return {
    id: issue.id,
    identifier: issue.identifier ?? null,
    url: issue.url ?? null,
    teamId: issue.teamId ?? input.teamId,
  };
}

async function createIssueComment(client, issueId, body) {
  const payload = await client.createComment({
    issueId,
    body,
  });
  if (!payload.success) {
    throw new Error("Linear comment creation reported success=false.");
  }

  const comment = await payload.comment;
  if (!comment?.id) {
    throw new Error("Linear comment creation did not return a comment.");
  }

  return {
    id: comment.id,
    body: comment.body ?? body,
  };
}

async function createIssueSession(client, issueId) {
  const payload = await client.agentSessionCreateOnIssue({ issueId });
  if (!payload.success) {
    throw new Error("Linear issue session creation reported success=false.");
  }

  const session = await payload.agentSession;
  if (!session?.id) {
    throw new Error("Linear issue session creation did not return a session.");
  }

  return { id: session.id };
}

async function createCommentSession(client, commentId) {
  const payload = await client.agentSessionCreateOnComment({ commentId });
  if (!payload.success) {
    throw new Error("Linear comment session creation reported success=false.");
  }

  const session = await payload.agentSession;
  if (!session?.id) {
    throw new Error("Linear comment session creation did not return a session.");
  }

  return { id: session.id };
}

async function waitForSessionOutcome(client, sessionId, options) {
  const deadline = Date.now() + options.timeoutMs;
  let lastSeen = null;
  let pollCount = 0;

  while (Date.now() < deadline) {
    const session = await client.agentSession(sessionId);
    const activitiesConnection = await session.activities();
    const activities = activitiesConnection.nodes ?? [];

    const thoughts = [];
    const responses = [];
    const errors = [];
    const elicitations = [];

    for (const activity of activities) {
      const content = activity.content ?? {};
      const body = typeof content.body === "string" ? content.body : "";
      switch (content.__typename) {
        case "AgentActivityThoughtContent":
          thoughts.push(body);
          break;
        case "AgentActivityResponseContent":
          responses.push(body);
          break;
        case "AgentActivityErrorContent":
          errors.push(body);
          break;
        case "AgentActivityElicitationContent":
          elicitations.push(body);
          break;
        default:
          break;
      }
    }

    lastSeen = {
      status: session.status,
      thoughts,
      responses,
      errors,
      elicitations,
    };
    pollCount += 1;
    if (options.tracePath) {
      writeFileSync(
        options.tracePath,
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          sessionId,
          pollCount,
          status: session.status,
          counts: {
            thoughts: thoughts.length,
            responses: responses.length,
            errors: errors.length,
            elicitations: elicitations.length,
          },
          latest: {
            thought: thoughts[0] ?? null,
            response: responses[0] ?? null,
            error: errors[0] ?? null,
            elicitation: elicitations[0] ?? null,
          },
        })}\n`,
        { flag: "a" },
      );
    }

    const bridgeError = errors.find((entry) => entry.includes("Bridge error:"));
    if (bridgeError) {
      throw new Error(`Session ${sessionId} failed with bridge error: ${bridgeError}`);
    }

    if (session.status === "complete" && responses.length > 0) {
      return lastSeen;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for session ${sessionId} to complete. Last state: ${JSON.stringify(lastSeen)}`,
  );
}

async function getIssueSnapshot(client, issueId) {
  const issue = await client.issue(issueId);
  const commentsConnection = await issue.comments({ first: 100 });
  const comments = (commentsConnection.nodes ?? []).map((comment) => ({
    id: comment.id,
    body: comment.body ?? "",
    updatedAt: comment.updatedAt?.toISOString?.() ?? String(comment.updatedAt ?? ""),
  }));

  const state = issue.state ? await issue.state : null;
  const assignee = issue.assignee ? await issue.assignee : null;
  return {
    title: issue.title ?? "",
    description: issue.description ?? "",
    assignee: assignee
      ? {
        id: assignee.id,
        name: assignee.displayName ?? assignee.name ?? "",
      }
      : null,
    state: state
      ? {
        id: state.id,
        name: state.name ?? "",
        type: state.type ?? "",
      }
      : null,
    commentCount: comments.length,
    comments,
  };
}

async function listWorkflowStates(client, teamId) {
  const connection = await client.workflowStates({ teamId });
  return (connection.nodes ?? []).map((state) => ({
    id: state.id,
    name: state.name ?? "",
    type: state.type ?? "",
    position: state.position ?? Number.MAX_SAFE_INTEGER,
  }));
}

function pickInProgressState(states) {
  const exact = states.find((state) => state.name === "In Progress");
  if (exact?.id) {
    return exact;
  }

  const firstStarted = states.find((state) => state.type === "started" && state.id);
  if (firstStarted) {
    return firstStarted;
  }

  throw new Error("Unable to resolve an in-progress workflow state.");
}

function pickReviewState(states) {
  const exact = states.find((state) => state.name === "In Review");
  if (exact?.id) {
    return exact;
  }

  const fuzzy = states.find((state) => /review/i.test(state.name) && state.id);
  if (fuzzy) {
    return fuzzy;
  }

  return null;
}

async function updateIssueWorkflow(client, issueId, input) {
  const payload = await client.updateIssue(issueId, input);
  if (!payload.success) {
    throw new Error(`Issue workflow update failed for ${issueId}.`);
  }
}

function evaluateEnrichment(before, after, session) {
  return [
    check("session_completed", session.status === "complete", `status=${session.status}`),
    check(
      "ticket_changed",
      before.title !== after.title || before.description !== after.description,
      "expected title or description update",
    ),
    check("linear_response_present", session.responses.length > 0, "expected final response activity"),
  ];
}

function evaluateImplementation(before, after, session, reviewState) {
  const reviewReached = reviewState
    ? after.state?.id === reviewState.id
      || (after.state?.name ?? "").toLowerCase().includes(reviewState.name.toLowerCase())
    : true;
  const commentGrowth = after.commentCount > before.commentCount;
  const hasAssignee = Boolean(after.assignee?.id);

  return [
    check("session_completed", session.status === "complete", `status=${session.status}`),
    check(
      "moved_to_review",
      reviewReached,
      reviewState
        ? `state=${after.state?.name ?? "unknown"}`
        : "team has no review-style workflow state; skipped strict review-state assertion",
    ),
    check(
      "issue_assigned",
      hasAssignee,
      "expected issue assignee to be set before or during implementation",
      { required: false },
    ),
    check("implementation_comment_added", commentGrowth, "expected at least one new issue comment"),
    check("linear_response_present", session.responses.length > 0, "expected final response activity"),
  ];
}

function evaluateFollowUp(before, after, session) {
  const commentStreamIntact = after.commentCount >= before.commentCount;
  return [
    check("session_completed", session.status === "complete", `status=${session.status}`),
    check("no_bridge_errors", session.errors.length === 0, `errors=${session.errors.length}`),
    check("state_not_regressed", after.state?.id === before.state?.id, `before=${before.state?.name ?? "unknown"} after=${after.state?.name ?? "unknown"}`),
    check("comment_stream_intact", commentStreamIntact, "issue comments unexpectedly shrank"),
  ];
}

function summarizeWorkspaces(rootDir) {
  if (!existsSync(rootDir)) {
    return {
      root: rootDir,
      directories: [],
    };
  }

  const directories = readdirSync(rootDir)
    .map((entry) => join(rootDir, entry))
    .filter((entry) => statSync(entry).isDirectory())
    .sort((left, right) => left.localeCompare(right))
    .map((directory) => ({
      path: directory,
      files: walkFiles(directory),
    }));

  return {
    root: rootDir,
    directories,
  };
}

function walkFiles(rootDir, prefix = "") {
  const entries = readdirSync(rootDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const output = [];

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    output.push(relativePath);
    if (entry.isDirectory()) {
      output.push(...walkFiles(join(rootDir, entry.name), relativePath));
    }
  }

  return output;
}

function assertWorkspaceOutputs(workspaceSummary) {
  const coderWorkspace = workspaceSummary.directories.find((entry) => /coder-/i.test(entry.path));
  if (!coderWorkspace) {
    throw new Error(`Coder workspace was not created under ${workspaceSummary.root}.`);
  }

  const concreteFiles = coderWorkspace.files.filter((file) => file !== "WORKSPACE.md");
  if (concreteFiles.length === 0) {
    throw new Error(`Coder workspace ${coderWorkspace.path} did not contain any files beyond WORKSPACE.md.`);
  }
}

function check(name, passed, detail, options = {}) {
  return {
    name,
    passed,
    detail,
    required: options.required ?? true,
  };
}

function assertScenarioPassed(name, checks) {
  const failed = checks.filter((entry) => entry.required !== false && !entry.passed);
  if (failed.length === 0) {
    return;
  }

  throw new Error(`${name} failed checks: ${failed.map((entry) => `${entry.name} (${entry.detail})`).join(", ")}`);
}

function firstLine(value) {
  if (!value) {
    return null;
  }

  return value.split("\n")[0]?.trim() ?? null;
}

function writeSummary(root, data) {
  writeFileSync(join(root, "summary.json"), `${JSON.stringify(data, null, 2)}\n`, "utf8");

  const markdown = [
    "# Linear dogfood run",
    "",
    `- Run root: \`${root}\``,
    `- Started: \`${data.startedAt ?? "unknown"}\``,
    `- Finished: \`${data.finishedAt ?? "unknown"}\``,
    `- Issue: \`${data.issue?.identifier ?? "unknown"}\` ${data.issue?.url ?? ""}`.trim(),
    `- Webhook URL: \`${data.bridge?.webhookUrl ?? "unknown"}\``,
    `- Specialist workspaces: \`${data.workspaces?.root ?? "unknown"}\``,
    "",
    "## Scenarios",
    "",
    ...(data.scenarios ?? []).map((scenario) => {
      const failed = (scenario.checks ?? []).filter((entry) => !entry.passed);
      return `- ${scenario.name}: ${failed.length === 0 ? "passed" : "failed"} (${scenario.sessionId})`;
    }),
    "",
    "## Workspaces",
    "",
    ...((data.workspaces?.directories ?? []).map((workspace) => `- \`${workspace.path}\`: ${(workspace.files ?? []).join(", ") || "(empty)"}`)),
    "",
    data.error ? `## Error\n\n${data.error}\n` : "",
  ].filter(Boolean);

  writeFileSync(join(root, "summary.md"), `${markdown.join("\n")}\n`, "utf8");
}

async function sleep(ms) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function tailLines(text, count) {
  const lines = String(text ?? "").split("\n").filter((line) => line.trim().length > 0);
  return lines.slice(-count).join("\n");
}

function ensureBridgePortReady(port) {
  const lsof = spawnSync(
    "lsof",
    ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"],
    { encoding: "utf8" },
  );
  const pidLines = lsof.stdout?.trim().split("\n").filter(Boolean) ?? [];
  const pids = [...new Set(pidLines.map((line) => Number(line)).filter((pid) => Number.isInteger(pid) && pid > 0))];
  if (pids.length === 0) {
    return { killedPids: [] };
  }

  const autoKill = process.env.LINEAR_DOGFOOD_AUTO_KILL_PORT !== "0";
  if (!autoKill) {
    throw new Error(
      `Port ${port} is already in use by PIDs: ${pids.join(", ")}. Set LINEAR_DOGFOOD_AUTO_KILL_PORT=1 to auto-clean.`,
    );
  }

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // best effort
    }
  }

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const check = spawnSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    const still = check.stdout?.trim().split("\n").filter(Boolean) ?? [];
    if (still.length === 0) {
      return { killedPids: pids };
    }
  }

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // best effort
    }
  }

  return { killedPids: pids };
}

async function shutdown(reason, exitCode) {
  if (shuttingDown) {
    process.exit(exitCode);
  }

  shuttingDown = true;
  const notesPath = join(runRoot, "shutdown.txt");
  const existing = existsSync(notesPath) ? await readFile(notesPath, "utf8") : "";
  writeFileSync(
    notesPath,
    `${existing}reason=${reason} at ${new Date().toISOString()}\n`,
    "utf8",
  );

  for (const callback of shutdownCallbacks.reverse()) {
    try {
      await callback();
    } catch {
      // best effort cleanup
    }
  }

  process.exit(exitCode);
}
