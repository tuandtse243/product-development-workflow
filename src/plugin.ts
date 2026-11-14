import { existsSync } from "node:fs";
import { join } from "node:path";

let bundled: string | undefined;

/**
 * Root of the installed plugin (bin/ lives in it). The bundled CLI sits in <plugin>/bin, so `..` is the plugin;
 * from source (tests, tsx) `..` is the repository, and the plugin is found under plugins/aidw.
 */
export function pluginRoot(env: NodeJS.ProcessEnv): string {
  if (env.AIDW_PLUGIN_ROOT) return env.AIDW_PLUGIN_ROOT;
  const own = bundledRoot();
  if (own) return own;
  if (env.CLAUDE_PLUGIN_ROOT) return env.CLAUDE_PLUGIN_ROOT;
  return join(process.cwd(), "plugins", "aidw");
}

/**
 * The plugin this CLI was built into (or the repository's plugin when run from source), ignoring any environment
 * override: files that define the CLI's own behavior, such as the Change state machine in workflows/, come from here.
 */
export function bundledRoot(): string | null {
  if (typeof __dirname === "undefined") return null;
  if (bundled === undefined) {
    const up = join(__dirname, "..");
    bundled = existsSync(join(up, ".claude-plugin", "plugin.json")) ? up : join(up, "plugins", "aidw");
  }
  return bundled;
}
