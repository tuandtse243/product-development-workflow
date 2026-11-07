// Bundles the aidw CLI into a single dependency-free file inside the plugin's bin/,
// so the installed plugin never needs node_modules.
import { build } from "esbuild";
import { chmod } from "node:fs/promises";

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
