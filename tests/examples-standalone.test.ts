import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const EXAMPLES_DIR = path.resolve(process.cwd(), "examples");

describe("examples", () => {
  it("avoid cross-importing other example files", async () => {
    const entries = await readdir(EXAMPLES_DIR, { withFileTypes: true });
    const tsFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => entry.name);

    for (const filename of tsFiles) {
      const fullPath = path.join(EXAMPLES_DIR, filename);
      const source = await readFile(fullPath, "utf8");

      expect(source, `${filename} should be standalone`).not.toMatch(
        /from\s+["']\.(?:\/|$)|import\s*\(\s*["']\.(?:\/|$)/,
      );
      expect(source, `${filename} should not import from examples/`).not.toMatch(
        /from\s+["']\.\.\/examples\/|import\s*\(\s*["']\.\.\/examples\//,
      );
    }
  });
});
