import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export const AIDW_DIR = ".aidw";

export interface Paths {
  project: string;
  aidw: string;
  projectYaml: string;
  constitution: string;
  requirements: string;
  specs: string;
  domain: string;
  architecture: string;
  decisions: string;
  design: string;
  changes: string;
  archive: string;
  run: string;
}

export function pathsFor(project: string): Paths {
  const aidw = join(project, AIDW_DIR);
  return {
    project,
    aidw,
    projectYaml: join(aidw, "project.yaml"),
    constitution: join(aidw, "constitution.md"),
    requirements: join(aidw, "requirements"),
    specs: join(aidw, "specs"),
    domain: join(aidw, "domain"),
    architecture: join(aidw, "architecture"),
    decisions: join(aidw, "decisions"),
    design: join(aidw, "design"),
    changes: join(aidw, "changes"),
    archive: join(aidw, "archive"),
    run: join(aidw, "run"),
  };
}

/**
 * Resolves the project root: --root, then $CLAUDE_PROJECT_DIR when it holds .aidw/,
 * then the nearest ancestor of cwd that holds .aidw/.
 */
export function findProject(opts: { root?: string; cwd: string; env: NodeJS.ProcessEnv }): string | null {
  if (opts.root) return resolve(opts.cwd, opts.root);
  const envDir = opts.env.CLAUDE_PROJECT_DIR;
  if (envDir && existsSync(join(envDir, AIDW_DIR))) return resolve(envDir);
  let dir = resolve(opts.cwd);
  // A wave task's worktree (S8) holds a stale checkout of .aidw/; the project is the main checkout around it.
  const wt = new RegExp(`^(.*?)[\\/]${AIDW_DIR.replace(".", "\\.")}[\\/]run[\\/]worktrees(?:[\\/]|$)`).exec(dir);
  if (wt?.[1] && existsSync(join(wt[1], AIDW_DIR))) return wt[1];
  for (;;) {
    if (existsSync(join(dir, AIDW_DIR))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** greenfield | brownfield from project.yaml (written by `aidw init` from the detection), or null when unknown. */
export function projectKind(p: Paths): "greenfield" | "brownfield" | null {
  const text = readText(p.projectYaml);
  if (text === null) return null;
  const m = /^kind:\s*(greenfield|brownfield)\b/m.exec(text);
  return m ? (m[1] as "greenfield" | "brownfield") : null;
}

/** Project-relative path with forward slashes, for stable output and hashing. */
export function rel(p: Paths, file: string): string {
  return relative(p.project, file).split(sep).join("/");
}

export function readText(file: string): string | null {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

export function isDir(p: string): boolean {
  return existsSync(p) && statSync(p).isDirectory();
}

/** Recursively lists files under dir (absolute paths), skipping dotfiles. */
export function walkFiles(dir: string): string[] {
  if (!isDir(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    if (isDir(full)) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

/** Capability path of a spec file relative to a specs/ dir: specs/a/b/spec.md -> "a/b". */
export function capabilityOf(specsDir: string, file: string): string | null {
  const parts = relative(specsDir, file).split(sep);
  if (parts.length < 2 || parts[parts.length - 1] !== "spec.md") return null;
  return parts.slice(0, -1).join("/");
}

export const KEBAB_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
