import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { ValidationError } from "../core/errors";

export interface AgentConfigResult {
  agentId: string;
  apiKey: string;
  wsUrl?: string;
  restUrl?: string;
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
      `Config file not found: ${filePath}. Copy agent_config.yaml.example to agent_config.yaml and configure your agents.`,
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

  const { agent_id, api_key, ws_url, rest_url, ...rest } = section;

  const invalid = REQUIRED_FIELDS.filter(
    (field) => typeof section[field] !== "string" || (section[field] as string).trim() === "",
  );
  if (invalid.length > 0) {
    const keyHint = agentKey ? ` under key "${agentKey}"` : "";
    throw new ValidationError(
      `Invalid fields${keyHint} in ${filePath}: ${invalid.join(", ")} must be non-empty strings`,
    );
  }

  if (ws_url !== undefined && typeof ws_url !== "string") {
    throw new ValidationError(`ws_url in ${filePath} must be a string`);
  }
  if (rest_url !== undefined && typeof rest_url !== "string") {
    throw new ValidationError(`rest_url in ${filePath} must be a string`);
  }

  // Filter out keys that could pollute the object prototype.
  const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype", "toString", "valueOf"]);
  const safeRest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (!UNSAFE_KEYS.has(key)) {
      safeRest[key] = value;
    }
  }

  return {
    agentId: agent_id as string,
    apiKey: api_key as string,
    ...(ws_url !== undefined ? { wsUrl: ws_url } : {}),
    ...(rest_url !== undefined ? { restUrl: rest_url } : {}),
    ...safeRest,
  };
}
