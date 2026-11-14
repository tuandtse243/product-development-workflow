// Bundles the aidw CLI into a single dependency-free file inside the plugin's bin/,
// so the installed plugin never needs node_modules.
import { build } from "esbuild";
import { chmod } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const outfile = "plugins/aidw/bin/aidw";

await build({
  entryPoints: ["src/cli.ts"],
  outfile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "inline",
  logLevel: "warning",
});
await chmod(outfile, 0o755);
console.log(`built ${outfile}`);

// agents/ is generated from roles/ (ADR-0004); the freshly built CLI writes and checks it.
execFileSync(process.execPath, [outfile, "roster", "--write"], { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, AIDW_PLUGIN_ROOT: "plugins/aidw" } });
console.log("generated plugins/aidw/agents from roles/");
