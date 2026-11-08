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

export function isGitRepo(cwd: string): boolean {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"]).out === "true";
}

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
