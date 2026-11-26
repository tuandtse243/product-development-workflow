import { spawnSync } from "node:child_process";

export interface GitResult {
  ok: boolean;
  out: string;
  err: string;
}

export function git(cwd: string, args: string[]): GitResult {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() || (r.error?.message ?? "") };
}

/** The project's default branch: what origin/HEAD names, else one of the usual names. */
export function isDefaultBranch(cwd: string, name: string): boolean {
  const origin = git(cwd, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]);
  if (origin.ok && origin.out) return origin.out.replace(/^origin\//, "") === name;
  return ["main", "master", "trunk", "develop"].includes(name);
}

export function isGitRepo(cwd: string): boolean {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"]).out === "true";
}

/** Dependency and build-output folders that must never be committed (aidw commits with `git add -A`). */
// Per stack (stacks/<lang>.md "Paths never committed"): directories, files and suffixes. A directory that
// is junk in one language is never source in another, so all of them apply to every project.
export const STACK_JUNK: Record<string, { dirs: string[]; files: string[]; suffixes: string[] }> = {
  common: { dirs: ["coverage", "test-results"], files: [".DS_Store"], suffixes: [] },
  node: {
    dirs: ["node_modules", ".next", ".nuxt", ".svelte-kit", ".turbo", ".vercel", ".pnpm-store", ".vitest", "playwright-report"],
    files: ["next-env.d.ts"],
    suffixes: [".tsbuildinfo"],
  },
  python: { dirs: ["__pycache__", ".venv", "venv", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox"], files: [], suffixes: [".pyc"] },
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const all = Object.values(STACK_JUNK);
const GENERATED_PATH = new RegExp(
  `(^|/)(${all.flatMap((s) => s.dirs).map(escape).join("|")})/|(^|/)(${all.flatMap((s) => s.files).map(escape).join("|")})$|(${all.flatMap((s) => s.suffixes).map(escape).join("|")})$`,
);
/** Secrets files: never committed either, but a write to one is not "generated" for the backstop. */
const ENV_FILE = /(^|\/)\.env(?:\.(?!example$)[\w.-]+)?$/;
const JUNK_PATH = { test: (f: string) => GENERATED_PATH.test(f) || ENV_FILE.test(f) };

/** Files a tool generates while it runs (tsc state, Next shims, build output). */
export const isGeneratedPath = (f: string): boolean => GENERATED_PATH.test(f);

/** A secrets file such as `.env` or `.env.local` (`.env.example` is not one). */
export const isEnvFile = (f: string): boolean => ENV_FILE.test(f);

export function stagedJunk(cwd: string, paths: string[] = []): string[] {
  const r = git(cwd, ["diff", "--cached", "--name-only", ...(paths.length ? ["--", ...paths] : [])]);
  return r.ok ? r.out.split("\n").filter((f) => JUNK_PATH.test(f)) : [];
}

export const junkMessage = (files: string[]) =>
  `refusing to commit dependency or build output (${files.slice(0, 3).join(", ")}${files.length > 3 ? ", ..." : ""}): the project has no .gitignore covering it. Add node_modules/, .next/, *.tsbuildinfo, next-env.d.ts, .env and the like to .gitignore, run \`git rm -r -q --cached <path>\` for anything already tracked, then retry`;

/** Current commit, or null outside git or before the first commit. */
export function headCommit(cwd: string): string | null {
  const r = git(cwd, ["rev-parse", "--verify", "-q", "HEAD"]);
  return r.ok && r.out ? r.out : null;
}

/** Files changed since `base` (committed, staged, unstaged and untracked), project-relative. */
export function changedSince(cwd: string, base: string | null): string[] | null {
  if (!isGitRepo(cwd)) return null;
  const files = new Set<string>();
  const diff = base ? git(cwd, ["diff", "--name-only", base]) : git(cwd, ["diff", "--name-only", "--cached"]);
  if (!diff.ok) return null;
  for (const f of diff.out.split("\n")) if (f) files.add(f);
  if (!base) for (const f of git(cwd, ["diff", "--name-only"]).out.split("\n")) if (f) files.add(f);
  for (const f of git(cwd, ["ls-files", "--others", "--exclude-standard"]).out.split("\n")) if (f) files.add(f);
  return [...files].sort();
}
