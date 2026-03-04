/**
 * Custom tools utilities for adapters.
 *
 * Provides helper functions to convert Zod schemas to tool schemas
 * and execute custom tools with validation.
 */

import { z, type ZodIssue } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Custom tool definition: a Zod schema for validation + a handler function.
 */
export interface CustomToolDef {
  /** Zod object schema defining the tool's input parameters. */
  schema: z.ZodObject<z.ZodRawShape>;
  /** Handler function that receives validated input and returns a result. */
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
  /** Tool name as it will appear to the LLM. Used as-is (no transformation). */
  name: string;
  /** Override the tool description (defaults to schema description). */
  description?: string;
}

/**
 * Get the tool name from a CustomToolDef.
 *
 * Returns the `name` field directly — no transformation applied.
 */
export function getCustomToolName(def: CustomToolDef): string {
  return def.name;
}

/**
 * Convert a CustomToolDef to OpenAI function schema format.
 *
 * Returns: `{ type: "function", function: { name, description, parameters } }`
 */
export function customToolToOpenAISchema(def: CustomToolDef): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: getCustomToolName(def),
      description: def.description ?? def.schema.description ?? "",
      parameters: toCleanJsonSchema(def.schema),
    },
  };
}

/**
 * Convert a CustomToolDef to Anthropic tool schema format.
 *
 * Returns: `{ name, description, input_schema }`
 */
export function customToolToAnthropicSchema(def: CustomToolDef): Record<string, unknown> {
  return {
    name: getCustomToolName(def),
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

/**
 * Convert list of custom tools to schemas in specified format.
 */
export function customToolsToSchemas(
  tools: CustomToolDef[],
  format: "openai" | "anthropic",
): Record<string, unknown>[] {
  const converter = format === "openai" ? customToolToOpenAISchema : customToolToAnthropicSchema;
  return tools.map(converter);
}

/**
 * Find custom tool by name.
 *
 * Returns the matching CustomToolDef, or undefined if not found.
 */
export function findCustomTool(
  tools: CustomToolDef[] | Map<string, CustomToolDef>,
  name: string,
): CustomToolDef | undefined {
  if (tools instanceof Map) {
    return tools.get(name);
  }
  return tools.find((def) => getCustomToolName(def) === name);
}

/**
 * Build an index of custom tools by name for O(1) lookup.
 */
export function buildCustomToolIndex(tools: CustomToolDef[]): Map<string, CustomToolDef> {
  const index = new Map<string, CustomToolDef>();
  for (const def of tools) {
    index.set(getCustomToolName(def), def);
  }
  return index;
}

/**
 * Execute custom tool with Zod validation.
 *
 * Validates arguments against the schema, formats errors for LLM readability,
 * then calls the handler with the validated (and coerced) data.
 *
 * @throws {Error} If arguments fail validation (formatted for LLM)
 * @throws Re-throws any error from the handler function
 */
export async function executeCustomTool(
  def: CustomToolDef,
  arguments_: Record<string, unknown>,
): Promise<unknown> {
  const result = def.schema.safeParse(arguments_);

  if (!result.success) {
    const errors = result.error.issues.map(formatZodIssue);
    const toolName = getCustomToolName(def);
    throw new Error(`Invalid arguments for ${toolName}: ${errors.join(", ")}`);
  }

  const output = def.handler(result.data as Record<string, unknown>);
  if (output instanceof Promise) {
    return await output;
  }
  return output;
}

function formatZodIssue(issue: ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "value";
  return `${path}: ${issue.message}`;
}
