# Plan: the rest of the V5 trial findings

Written 2026-11-27, after F1 to F7 of `docs/plans/rpi-trial-fixes.md` were merged into `feat/rpi-trial-fixes`. This
plan takes the backlog in section 5 of that file. Each finding is quoted in `docs/plans/rpi-upgrades-trial.md`. Same
branch, same way of working: one worktree per task, test-first, a review agent per fix, the full suite after every
merge.

## Decisions

- **B-D1. A plan warning can be accepted with a reason, never silenced.** The planner writes the reason in
  `tasks.yaml`, and `aidw analyze` prints the accepted warning as INFO with that reason. The gate shows it. A warning
  accepted for a reason that no longer matches (the task changed) is a warning again.
- **B-D2. Every NEXT line says what really happens.** It describes the command as the current shell will run it.
- **B-D3. Delivery leaves a clean tree.** Every file a Role writes during delivery is in a delivery commit, so
  `aidw archive` commits only its own files.
- **B-D4. Ask the user for the test browser once, at intake,** with the other environment checks. Never in the
  middle of a stage.

## Tasks

| Task | What | Where to look | Done when |
|---|---|---|---|
| B1 | `aidw detect`: a `pnpm-workspace.yaml` with no `packages:` (only settings such as `allowBuilds`) is not a monorepo. Read the file before warning; do the same for other workspace files where the signal is a file whose content says whether it is a workspace (`package.json` `workspaces`). | `src/detect.ts:189` `monorepoSignal`, its tests | Tests: settings-only file gives no signal; a file with `packages:` still does. |
| B2 | B-D1. A task may carry `accept:` entries, each a warning code and a reason (e.g. `{ warn: depends-without-overlap, on: T01, why: "T03's 409 tests need T01's trigger" }`, `{ warn: large-task, why: "every scenario goes through editBooking" }`). Give each plan warning a stable code. `aidw analyze` prints an accepted one as INFO `accepted: <warning>: <why>`. The gate plan section lists accepted warnings. The technical-planner Role learns the field. | the plan warnings in `src/planreview.ts` / `src/analyze.ts` / `src/plan.ts`, the tasks.yaml schema in `src/tasks.ts`, `roles/technical-planner` | Tests on the trial's two warnings; planner eval case `accepts-a-warning-with-its-reason` 3/3. |
| B3 | `runner.log`: keep the whole final message of each session (not the last 8 lines), indented as now. Record each session's cost and turns when the `claude -p` output gives them, and a total at the end. | `src/runner.ts:286` | Test on a long final message and on a cost line. |
| B4 | B-D2. `aidw run --detach` from a non-tty shell: either ask, or say in the NEXT line that it starts without asking when no terminal is attached. Pick the one that keeps the orchestrator's headless flow working, and say which you chose. Check other NEXT lines that promise a confirmation. | `src/runner.ts`, `src/cli.ts` (the `aidw approve` NEXT line) | Test of the NEXT text with and without a tty. |
| B5 | PR body: the summary (`pr-summary.md`, with its H1 as the PR title) comes first, then the generated sections. A manual check is listed once, under "Needed from the user", and the task list marks it as "manual check open", not "done". "Merge danger" names the real default branch of the repo (`git symbolic-ref refs/remotes/origin/HEAD`, else `init.defaultBranch`, else the branch the Change started from), not `main`. | `src/pr.ts:112` and `:149`, `src/deliver.ts` | Tests on the order, the single manual check and a repo whose branch is `master`. |
| B6 | B-D3. Delivery commits what the Documentation Role wrote (README and API docs) in its own commit before it reports done. `aidw archive` no longer finds it uncommitted. | `src/deliver.ts`, the archive command in `src/ops.ts` | Test: after delivery the tree is clean; archive commits only `.aidw/`. |
| B7 | Design step: when the project already has `.aidw/design/tokens.yaml` from an earlier Change and this Change adds no new kind of screen, the orchestrator records `reuse-existing` with its reason and confirms it with one line in the chat. No Decision Page. | `skills/start/SKILL.md` step 5 | A guard test reads the rule. |
| B8 | B-D4. Move the test browser question to the intake environment preflight (step 1), only when the Change has UI and an e2e layer. `aidw run` keeps starting the browser itself. | `skills/start/SKILL.md` steps 1 and 8 | A guard test reads the rule. |

Implementer order (one at a time): B1+B3+B4 (CLI, small), then B5+B6 (delivery), then B2 (plan warnings, with the
Role), then B7+B8 (skill text).

**Done:** all tasks merged, the full suite and `aidw roster` are clean, and the technical-planner evals pass.
