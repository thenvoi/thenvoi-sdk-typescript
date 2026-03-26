/**
 * Sync the version from package.json into both the source and dist openclaw.plugin.json.
 * Run after tsup builds the dist/ directory.
 *
 * This ensures the source plugin.json stays in sync with package.json
 * (release-please bumps package.json but not plugin.json).
 */
import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const pluginPath = "openclaw.plugin.json";
const distPluginPath = "dist/openclaw.plugin.json";

// Sync source plugin.json
const plugin = JSON.parse(readFileSync(pluginPath, "utf8"));
if (plugin.version !== pkg.version) {
  plugin.version = pkg.version;
  writeFileSync(pluginPath, JSON.stringify(plugin, null, 2) + "\n");
  console.log(`[sync-plugin-version] Updated source ${pluginPath} to ${pkg.version}`);
}

// Sync dist plugin.json
writeFileSync(distPluginPath, JSON.stringify(plugin, null, 2) + "\n");
console.log(`[sync-plugin-version] Set ${distPluginPath} version to ${pkg.version}`);
