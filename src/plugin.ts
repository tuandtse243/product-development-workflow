import { existsSync } from "node:fs";
import { join } from "node:path";

let bundled: string | undefined;

/**
 * Root of the installed plugin (bin/ lives in it). The bundled CLI sits in <plugin>/bin, so `..` is the plugin;
 * from source (tests, tsx) `..` is the repository, and the plugin is found under plugins/aidw.
 */
export function pluginRoot(env: NodeJS.ProcessEnv): string {
  if (env.AIDW_PLUGIN_ROOT) return env.AIDW_PLUGIN_ROOT;
  if (typeof __dirname !== "undefined") {
    if (bundled === undefined) {
      const up = join(__dirname, "..");
      bundled = existsSync(join(up, ".claude-plugin", "plugin.json")) ? up : join(up, "plugins", "aidw");
    }
    return bundled;
  }
  if (env.CLAUDE_PLUGIN_ROOT) return env.CLAUDE_PLUGIN_ROOT;
  return join(process.cwd(), "plugins", "aidw");
}
