import { existsSync, readdirSync, statSync } from "node:fs";
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

/**
 * A file inside the plugin, by its path relative to the plugin root. An Agent often drops the extension or names the
 * skill folder (seen on trial-4: the planner asked for `roles/technical-planner/skills/scaffold-tasks`, was told it
 * did not exist, and planned without its three skills). So `<path>.md` and `<path>/SKILL.md` count as the same file,
 * and a path that still matches nothing comes back with the closest names in the nearest folder that exists.
 */
export function resolvePluginFile(root: string, ref: string): { file: string } | { tried: string; suggestions: string[] } {
  const parts = ref.split("/");
  const base = join(root, ...parts);
  for (const candidate of [base, `${base}.md`, join(base, "SKILL.md")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return { file: candidate };
  }
  // the nearest folder that exists, and the names in it closest to what was asked
  let depth = parts.length - 1;
  while (depth > 0 && !existsSync(join(root, ...parts.slice(0, depth)))) depth--;
  const dir = join(root, ...parts.slice(0, depth));
  const wanted = (parts[depth] ?? "").replace(/\.md$/, "").toLowerCase();
  const names = existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir).filter((n) => !n.startsWith(".")) : [];
  const score = (n: string) => {
    const s = n.replace(/\.md$/, "").toLowerCase();
    return s === wanted ? 0 : s.includes(wanted) || wanted.includes(s) ? 1 : distance(s, wanted);
  };
  const suggestions = names
    .map((n) => ({ n, d: score(n) }))
    .filter((x) => x.d <= Math.max(3, Math.floor(wanted.length / 3)))
    .sort((a, b) => a.d - b.d || a.n.localeCompare(b.n))
    .slice(0, 3)
    .map((x) => [...parts.slice(0, depth), x.n].join("/"));
  return { tried: base, suggestions };
}

/** Edit distance between two short names. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length]!;
}
