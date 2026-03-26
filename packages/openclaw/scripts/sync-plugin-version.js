/**
 * Sync the version from package.json into dist/openclaw.plugin.json.
 * Run after tsup builds the dist/ directory.
 */
import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const pluginPath = "openclaw.plugin.json";
const distPluginPath = "dist/openclaw.plugin.json";

const plugin = JSON.parse(readFileSync(pluginPath, "utf8"));
plugin.version = pkg.version;
writeFileSync(distPluginPath, JSON.stringify(plugin, null, 2) + "\n");

console.log(`[sync-plugin-version] Set dist/openclaw.plugin.json version to ${pkg.version}`);
