import { z, type ZodIssue } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export interface CustomToolDef {
  schema: z.ZodObject<z.ZodRawShape>;
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
  name: string;
  description?: string;
}

export class CustomToolValidationError extends Error {
  public readonly toolName: string;
  public readonly issues: string[];

  public constructor(toolName: string, issues: string[]) {
    super(`Invalid arguments for ${toolName}: ${issues.join(", ")}`);
    this.name = "CustomToolValidationError";
    this.toolName = toolName;
    this.issues = issues;
  }
}

export class CustomToolExecutionError extends Error {
  public readonly toolName: string;
  public readonly cause: unknown;

  public constructor(toolName: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Custom tool ${toolName} failed: ${message}`);
    this.name = "CustomToolExecutionError";
    this.toolName = toolName;
    this.cause = cause;
  }
}

export function getCustomToolName(def: CustomToolDef): string {
  const name = def.name.trim();
  if (!name) {
    throw new Error("Custom tool name must be a non-empty string.");
  }

  return name;
}

export function customToolToOpenAISchema(def: CustomToolDef): Record<string, unknown> {
  const name = getCustomToolName(def);
  return {
    type: "function",
    function: {
      name,
      description: def.description ?? def.schema.description ?? "",
      parameters: toCleanJsonSchema(def.schema),
    },
  };
}

export function customToolToAnthropicSchema(def: CustomToolDef): Record<string, unknown> {
  const name = getCustomToolName(def);
  return {
    name,
    description: def.description ?? def.schema.description ?? "",
    input_schema: toCleanJsonSchema(def.schema),
  };
}

function toCleanJsonSchema(schema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
  const jsonSchema = zodToJsonSchema(schema, { target: "jsonSchema7" }) as Record<string, unknown>;
  delete jsonSchema["$schema"];
  delete jsonSchema["additionalProperties"];
  return jsonSchema;
}

export function customToolsToSchemas(
  tools: CustomToolDef[],
  format: "openai" | "anthropic",
): Record<string, unknown>[] {
  const converter = format === "openai" ? customToolToOpenAISchema : customToolToAnthropicSchema;
  return tools.map(converter);
}

export function findCustomTool(
  tools: CustomToolDef[],
  name: string,
): CustomToolDef | undefined {
  return tools.find((def) => getCustomToolName(def) === name);
}

export function findCustomToolInIndex(
  index: Map<string, CustomToolDef>,
  name: string,
): CustomToolDef | undefined {
  return index.get(name);
}

export function buildCustomToolIndex(tools: CustomToolDef[]): Map<string, CustomToolDef> {
  const index = new Map<string, CustomToolDef>();
  for (const def of tools) {
    index.set(getCustomToolName(def), def);
  }
  return index;
}

export async function executeCustomTool(
  def: CustomToolDef,
  arguments_: Record<string, unknown>,
): Promise<unknown> {
  const toolName = getCustomToolName(def);
  const result = def.schema.safeParse(arguments_);

  if (!result.success) {
    const errors = result.error.issues.map(formatZodIssue);
    throw new CustomToolValidationError(toolName, errors);
  }

  try {
    const output = def.handler(result.data as Record<string, unknown>);
    if (output instanceof Promise) {
      return await output;
    }
    return output;
  } catch (error) {
    if (error instanceof CustomToolValidationError || error instanceof CustomToolExecutionError) {
      throw error;
    }
    throw new CustomToolExecutionError(toolName, error);
  }
}

function formatZodIssue(issue: ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "value";
  return `${path}: ${issue.message}`;
}
