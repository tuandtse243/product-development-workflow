/**
 * Guard: a task may not change the configuration of the checks that judge it (ADR-0006). Lint, type-check, CI and
 * git-hook configuration is locked: only a task whose approved type is `build`, `ci` or `chore` may change an
 * existing file. Creating a file is setup, not weakening, and is allowed. Test-runner and coverage configuration is
 * not locked, because a feature often has to touch it; a change there is listed for the reviewer.
 */
import { git } from "./git.js";

const base = (f: string) => f.split("/").pop() ?? f;

const LOCKED_NAME =
  /^(?:\.eslintrc(?:\.[a-z]+)?|eslint\.config\.[cm]?[jt]s|\.eslintignore|\.oxlintrc\.json|biome\.jsonc?|\.prettierrc(?:\.[a-z]+)?|prettier\.config\.[cm]?[jt]s|tsconfig(?:\.[\w-]+)?\.json|jsconfig\.json|ruff\.toml|\.ruff\.toml|pyrightconfig\.json|mypy\.ini|\.flake8|\.pylintrc|commitlint\.config\.[cm]?[jt]s|\.commitlintrc(?:\.[a-z]+)?|\.lintstagedrc(?:\.[a-z]+)?|lint-staged\.config\.[cm]?[jt]s|lefthook\.ya?ml|\.pre-commit-config\.yaml|\.gitlab-ci\.yml|\.dependency-cruiser\.[cm]?js|knip\.jsonc?|\.importlinter|\.squawk\.toml|\.hadolint\.yaml)$/;
const LOCKED_DIR = /(?:^|\/)(?:\.github\/workflows|\.husky|\.circleci)\//;
const WATCHED_NAME = /^(?:vitest\.(?:config|workspace)\.[cm]?[jt]s|jest\.config\.[cm]?[jt]s|playwright\.config\.[cm]?[jt]s|cypress\.config\.[cm]?[jt]s|\.coveragerc|codecov\.ya?ml|\.nycrc(?:\.json)?|pytest\.ini|tox\.ini|conftest\.py)$/;

export const isLockedConfig = (f: string): boolean => LOCKED_DIR.test(f) || LOCKED_NAME.test(base(f));
export const isWatchedConfig = (f: string): boolean => WATCHED_NAME.test(base(f));

/** Task types whose job is the tooling itself (Conventional Commits). */
const TOOLING_TYPES = new Set(["build", "ci", "chore"]);

export interface ConfigEvidence {
  /** locked files this task changed without being a tooling task: fails the checkpoint */
  locked: string[];
  /** check configuration this task changed and was allowed to: the reviewer judges whether a check got weaker */
  watched: string[];
}

export function configEvidence(dir: string, baseCommit: string | null, changed: string[] | null, taskType: unknown): ConfigEvidence | null {
  if (changed === null) return null;
  const existed = (f: string) => baseCommit !== null && git(dir, ["cat-file", "-e", `${baseCommit}:${f}`]).ok;
  const tooling = typeof taskType === "string" && TOOLING_TYPES.has(taskType);
  const locked: string[] = [];
  const watched: string[] = [];
  for (const f of changed) {
    if (isLockedConfig(f)) {
      if (!existed(f)) continue; // a new file: setting a tool up
      (tooling ? watched : locked).push(f);
    } else if (isWatchedConfig(f) && existed(f)) watched.push(f);
  }
  return { locked, watched };
}
