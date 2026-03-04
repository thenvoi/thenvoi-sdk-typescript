import { pathToFileURL } from "node:url";

/**
 * Returns true when the calling module is the Node.js entry point
 * (i.e. the file passed to `node` / `tsx` on the command line).
 *
 * Usage:
 * ```ts
 * if (isDirectExecution(import.meta.url)) {
 *   // only runs when this file is executed directly
 * }
 * ```
 */
export function isDirectExecution(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  return importMetaUrl === pathToFileURL(entry).href;
}
