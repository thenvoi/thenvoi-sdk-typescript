import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  Agent,
  CodexAdapter,
  GenericAdapter,
  isDirectExecution,
  loadAgentConfig,
} from "../../src/index";

interface LinearThenvoiSpecialistAgentOptions {
  agentId?: string;
  apiKey?: string;
  roleName: string;
  roleInstructions: string;
  cwd?: string;
  workspaceMode?: "configured" | "temp";
  workspacePrefix?: string;
  codexModel?: string;
  mode?: "codex" | "scripted";
}

export function createLinearThenvoiSpecialistAgent(
  options: LinearThenvoiSpecialistAgentOptions,
): Agent {
  const workspace = resolveSpecialistWorkspace(options);
  const workspaceLabel = workspace ?? "(current process working directory)";
  const mode = resolveSpecialistMode(options.mode);
  const adapter = mode === "codex"
    ? new CodexAdapter({
      config: {
        model: options.codexModel ?? process.env.CODEX_MODEL ?? "gpt-5.3-codex",
        cwd: workspace,
        approvalPolicy: "never",
        sandboxMode: "workspace-write",
        enableExecutionReporting: true,
        emitThoughtEvents: true,
        customSection: buildSpecialistPrompt({
          roleName: options.roleName,
          roleInstructions: options.roleInstructions,
          workspace: workspaceLabel,
        }),
      },
    })
    : createScriptedSpecialistAdapter({
      roleName: options.roleName,
      workspace,
    });

  return Agent.create({
    adapter,
    config: {
      agentId: options.agentId ?? `agent-${options.roleName.toLowerCase().replace(/\s+/g, "-")}`,
      apiKey: options.apiKey ?? "api-key",
    },
  });
}

function resolveSpecialistMode(configured?: "codex" | "scripted"): "codex" | "scripted" {
  if (configured) {
    return configured;
  }

  const envMode = process.env.LINEAR_THENVOI_SPECIALIST_MODE?.trim().toLowerCase();
  if (envMode === "codex" || envMode === "scripted") {
    return envMode;
  }

  return process.env.LINEAR_THENVOI_FORCE_CODEX === "1" ? "codex" : "scripted";
}

function createScriptedSpecialistAdapter(input: {
  roleName: string;
  workspace?: string;
}): GenericAdapter {
  const handledRooms = new Set<string>();
  const role = input.roleName.toLowerCase();

  return new GenericAdapter(async ({ message, tools, roomId }) => {
    if (handledRooms.has(roomId)) {
      return;
    }

    const content = (message.content || "").toLowerCase();
    const plannerMatch = role.includes("planner") && content.includes("sharpen the ticket");
    const coderMatch = role.includes("coder") && content.includes("implement the requested deliverable");
    if (!plannerMatch && !coderMatch) {
      return;
    }

    handledRooms.add(roomId);
    const participants = await tools.getParticipants();
    const coordinator = participants.find((participant) => {
      const handle = (participant.handle ?? "").toLowerCase();
      const name = (participant.name ?? "").toLowerCase();
      return handle.includes("linear-bridge") || name.includes("linear bridge");
    });
    const mention = coordinator?.handle ? `@${coordinator.handle}` : null;
    if (!mention) {
      return;
    }

    if (plannerMatch) {
      await tools.sendEvent("Planner scripted mode: producing execution-ready ticket enrichment.", "thought");
      await tools.sendMessage(
        [
          "Execution-ready enrichment:",
          "- Scope: single responsive dog adoption landing page with hero, trust section, adoption steps, and CTA.",
          "- Acceptance criteria: mobile-first layout, clear primary CTA, scannable sections, and accessible color contrast.",
          "- Implementation notes: ship static HTML/CSS first, then optional component refactor.",
        ].join("\n"),
        [mention],
      );
      return;
    }

    if (input.workspace) {
      mkdirSync(input.workspace, { recursive: true });
      writeFileSync(
        resolve(input.workspace, "index.html"),
        [
          "<!doctype html>",
          "<html lang=\"en\">",
          "<head>",
          "  <meta charset=\"utf-8\">",
          "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
          "  <title>Dog Adoption Landing</title>",
          "  <link rel=\"stylesheet\" href=\"styles.css\">",
          "</head>",
          "<body>",
          "  <main>",
          "    <h1>Find Your Next Best Friend</h1>",
          "    <p>Adopt a dog from local shelters in minutes.</p>",
          "    <a href=\"#adopt\">Start Adoption</a>",
          "  </main>",
          "</body>",
          "</html>",
        ].join("\n"),
        "utf8",
      );
      writeFileSync(
        resolve(input.workspace, "styles.css"),
        [
          "body { font-family: sans-serif; margin: 0; padding: 2rem; background: #f7f8f2; color: #213026; }",
          "main { max-width: 720px; margin: 0 auto; }",
          "a { display: inline-block; margin-top: 1rem; padding: 0.75rem 1rem; background: #2f7a4a; color: #fff; text-decoration: none; border-radius: 0.5rem; }",
        ].join("\n"),
        "utf8",
      );
    }

    await tools.sendEvent("Coder scripted mode: generated landing page files in isolated workspace.", "thought");
    await tools.sendMessage(
      [
        "Implementation complete.",
        input.workspace ? `Files created: ${resolve(input.workspace, "index.html")}, ${resolve(input.workspace, "styles.css")}` : "Files created: index.html, styles.css",
        "Run: open index.html in a browser for review.",
      ].join("\n"),
      [mention],
    );
  });
}

export function createLinearThenvoiPlannerAgent(
  options?: Omit<LinearThenvoiSpecialistAgentOptions, "roleName" | "roleInstructions">,
): Agent {
  return createLinearThenvoiSpecialistAgent({
    ...options,
    roleName: "Ticket Planner",
    roleInstructions: `Turn vague asks into execution-ready tickets.
- Produce a clearer title when needed.
- Expand the summary into a short problem statement and desired outcome.
- Add concrete scope boundaries, implementation notes, and acceptance criteria.
- If the current ask is only enrichment, do not implement code.
- Hand the coder a crisp build brief when implementation should follow.`,
    workspaceMode: options?.workspaceMode ?? "temp",
    workspacePrefix: options?.workspacePrefix ?? "thenvoi-linear-planner-",
  });
}

export function createLinearThenvoiCoderAgent(
  options?: Omit<LinearThenvoiSpecialistAgentOptions, "roleName" | "roleInstructions">,
): Agent {
  return createLinearThenvoiSpecialistAgent({
    ...options,
    roleName: "Landing Page Coder",
    roleInstructions: `Treat your workspace as a fresh implementation sandbox.
- Default to a simple static site unless the room specifies a stack.
- Create the minimum runnable files needed for the requested deliverable.
- Report the concrete files you created or changed.
- Include brief run or preview instructions.
- If the brief is underspecified, make reasonable product decisions and note them.`,
    workspaceMode: options?.workspaceMode ?? "temp",
    workspacePrefix: options?.workspacePrefix ?? "thenvoi-linear-coder-",
  });
}

function buildSpecialistPrompt(input: {
  roleName: string;
  roleInstructions: string;
  workspace: string;
}): string {
  return `You are the ${input.roleName} in a Thenvoi multi-agent room.

Operate as a room specialist, not the coordinator.

Rules:
- Read the current room context carefully before acting.
- You do not use external ticketing tools directly. If you need more ticket context, ask the coordinator in the room.
- Contribute only when you have something concrete to add.
- Use thenvoi_send_message to share bounded findings, implementation status, review outcomes, or blocking questions back into the room.
- Do not coordinate the workflow unless the bridge explicitly asks you to plan or decide something narrow.
- Do not address the coordinator as if it were infrastructure; reply to the requesting participant naturally.
- Do not mention or assign work to yourself.
- Do not claim work is done unless you have actually completed or verified it.
- Do not restate that work is complete unless there is a new result to report.
- Prefer concise, high-signal updates over chatter.
- Treat your current working directory as an isolated workspace rooted at ${input.workspace}. If files already exist, inspect them before changing anything. If it is empty, create the minimal files needed for the requested deliverable.

Role-specific instructions:
${input.roleInstructions}`;
}

export function resolveSpecialistWorkspace(
  options: Pick<LinearThenvoiSpecialistAgentOptions, "cwd" | "workspaceMode" | "workspacePrefix">,
): string | undefined {
  if (options.cwd?.trim()) {
    const explicit = resolve(options.cwd.trim());
    mkdirSync(explicit, { recursive: true });
    return explicit;
  }

  if (options.workspaceMode !== "temp") {
    return undefined;
  }

  const baseDir = process.env.LINEAR_THENVOI_SPECIALIST_TMP_ROOT?.trim();
  if (baseDir) {
    const root = resolve(baseDir);
    if (!existsSync(root)) {
      mkdirSync(root, { recursive: true });
    }
    return mkdtempSync(join(root, options.workspacePrefix ?? "thenvoi-linear-specialist-"));
  }

  return mkdtempSync(join(tmpdir(), options.workspacePrefix ?? "thenvoi-linear-specialist-"));
}

if (isDirectExecution(import.meta.url)) {
  const configKey = process.env.LINEAR_THENVOI_SPECIALIST_CONFIG_KEY?.trim();
  const roleName = process.env.LINEAR_THENVOI_SPECIALIST_ROLE?.trim();

  if (!configKey) {
    throw new Error("Missing LINEAR_THENVOI_SPECIALIST_CONFIG_KEY.");
  }

  if (!roleName) {
    throw new Error("Missing LINEAR_THENVOI_SPECIALIST_ROLE.");
  }

  const instructions = process.env.LINEAR_THENVOI_SPECIALIST_INSTRUCTIONS?.trim()
    ?? "Respond based on the room's request and your role.";

  const config = loadAgentConfig(configKey);
  void createLinearThenvoiSpecialistAgent({
    ...config,
    roleName,
    roleInstructions: instructions,
    cwd: process.env.LINEAR_THENVOI_SPECIALIST_CWD?.trim(),
    workspaceMode: process.env.LINEAR_THENVOI_SPECIALIST_WORKSPACE_MODE?.trim() === "temp"
      ? "temp"
      : undefined,
    workspacePrefix: process.env.LINEAR_THENVOI_SPECIALIST_WORKSPACE_PREFIX?.trim(),
  }).run();
}
