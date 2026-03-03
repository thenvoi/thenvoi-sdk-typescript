import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { ValidationError } from "../core/errors";

export interface AgentConfigResult {
  agentId: string;
  apiKey: string;
  [key: string]: unknown;
}

const DEFAULT_CONFIG_PATH = "./agent_config.yaml";

const REQUIRED_FIELDS = ["agent_id", "api_key"] as const;

function toSnakeCase(key: string): string {
  return key.replace(/([A-Z])/g, "_$1").toLowerCase();
}

function normalizeKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[toSnakeCase(key)] = value;
  }
  return result;
}

export function loadAgentConfig(
  agentKey?: string,
  configPath?: string,
): AgentConfigResult {
  const filePath = configPath ?? DEFAULT_CONFIG_PATH;

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new ValidationError(
      `Config file not found: ${filePath}. Create an agent_config.yaml or pass a custom path.`,
    );
  }

  const parsed = yaml.load(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new ValidationError(`Invalid config file: ${filePath}. Expected a YAML object.`);
  }

  const config = parsed as Record<string, unknown>;

  // Try keyed format: config[agentKey] is an object with agent_id, api_key
  let section: Record<string, unknown>;
  if (agentKey && agentKey in config) {
    const keyed = config[agentKey];
    if (!keyed || typeof keyed !== "object") {
      throw new ValidationError(
        `Config key "${agentKey}" in ${filePath} must be an object with agent_id and api_key.`,
      );
    }
    section = normalizeKeys(keyed as Record<string, unknown>);
  } else {
    // Flat format: top-level agent_id, api_key
    section = normalizeKeys(config);
  }

  const missing = REQUIRED_FIELDS.filter((field) => !section[field]);
  if (missing.length > 0) {
    const keyHint = agentKey ? ` under key "${agentKey}"` : "";
    throw new ValidationError(
      `Missing required fields${keyHint} in ${filePath}: ${missing.join(", ")}`,
    );
  }

  const { agent_id, api_key, ...rest } = section;

  return {
    agentId: agent_id as string,
    apiKey: api_key as string,
    ...rest,
  };
}
