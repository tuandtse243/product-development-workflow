/**
 * Conventional Commits for the commits aidw makes itself (docs/adr/0002-conventional-commits.md,
 * docs/commit-guide.md). The message is built and checked here, not by the commitlint hook: the hook does not run in
 * a wave task's worktree, and a task that passed review must never be stuck on a rejected message.
 */
import { KEBAB_SEGMENT } from "./project.js";
import type { Task } from "./tasks.js";

export const COMMIT_TYPES = ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"] as const;
export type CommitType = (typeof COMMIT_TYPES)[number];

/** Whole header (`type(scope)!: subject`), so `git log --oneline` stays on one line. */
export const HEADER_MAX = 72;

/** Scope of a task with no capability (scaffold, tooling). */
export const DEFAULT_SCOPE = "config";

/** Tasks the workflow adds after approval carry no `type`; this is what they are. */
const ORIGIN_TYPE: Record<string, CommitType> = { converge: "test", quality: "fix", integration: "fix" };

const isType = (v: unknown): v is CommitType => typeof v === "string" && (COMMIT_TYPES as readonly string[]).includes(v);

/** Why a task's `type` / `breaking` is not usable, or null. Planned tasks must state a type; added ones need none. */
export function typeProblem(t: Task): string | null {
  if (t.type === undefined && ORIGIN_TYPE[String(t.origin)]) return null;
  if (!isType(t.type)) return `needs "type": one of ${COMMIT_TYPES.join(", ")} (Conventional Commits)`;
  if (t.breaking !== undefined && typeof t.breaking !== "boolean") return '"breaking" must be true or false';
  return null;
}

/** `<capability>/<requirement-id>` of the first spec -> kebab-case capability; no spec -> "config". */
export function scopeOf(t: Task): string {
  const spec = Array.isArray(t.specs) ? String(t.specs[0] ?? "") : "";
  const cap = spec.split("/").slice(0, -1).join("-").toLowerCase();
  return KEBAB_SEGMENT.test(cap) ? cap : DEFAULT_SCOPE;
}

/** Lowercase first word (acronyms such as API are kept), no trailing period, no line breaks. */
export function subjectOf(title: string, max: number): string {
  let s = title.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  const first = /^\S+/.exec(s)?.[0] ?? "";
  if (first && !/[A-Z].*[A-Z]/.test(first) && !/\d/.test(first)) s = first.toLowerCase() + s.slice(first.length);
  if (s.length > max) {
    const cut = s.slice(0, max);
    const at = cut.lastIndexOf(" ");
    s = (at > max / 2 ? cut.slice(0, at) : cut).replace(/[.,;:\s-]+$/, "");
  }
  return s || "update";
}

export function header(type: string, scope: string, subject: string, breaking = false): string {
  const head = `${type}(${scope})${breaking ? "!" : ""}: `;
  return head + subjectOf(subject, HEADER_MAX - head.length);
}

/** Message of a task commit. `evidence` is the project-relative evidence file. */
export function taskCommitMessage(t: Task, changeId: string, evidence: string): string {
  const type = isType(t.type) ? t.type : (ORIGIN_TYPE[String(t.origin)] ?? "chore");
  const h = header(type, scopeOf(t), String(t.title ?? ""), t.breaking === true);
  return `${h}\n\nChange: ${changeId}\nTask: ${t.id}\nEvidence: ${evidence}`;
}

/** Message of an aidw bookkeeping commit (delivered, archive). */
export function aidwCommitMessage(subject: string, footer: string): string {
  return `${header("chore", "aidw", subject)}\n\n${footer}`;
}

const HEADER_RE = new RegExp(`^(${COMMIT_TYPES.join("|")})(\\([a-z0-9]+(?:-[a-z0-9]+)*\\))?!?: \\S.*$`);

/** Mirrors `@commitlint/config-conventional` closely enough for tests and for self-checks before committing. */
export function isConventional(message: string): boolean {
  const line = message.split("\n")[0] ?? "";
  return line.length <= HEADER_MAX && HEADER_RE.test(line) && !line.endsWith(".");
}
