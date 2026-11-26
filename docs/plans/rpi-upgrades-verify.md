# Plan and handover: verify the rpi upgrades, merge them, and try them on a real Change

Written 2026-11-26, right after `docs/plans/rpi-upgrades.md` was built and opened as pull request #4
(`feat/rpi-upgrades` → `feat/factory-run-to-pr`). That Change is complete in code and tests; what it has not had is
proof that the new and changed Roles behave as intended when a model runs them, a review of the pull request, and a
run of the whole new flow on a real project. This file is the handover for the session that does that.

## 1. Read first

1. `docs/plans/rpi-upgrades.md`: sections 2 (decisions), 4 (tasks) and 5 (the owner's answers OP1 to OP4, R1 to R3).
2. Pull request #4 description (`gh pr view 4`): what landed per task, the choices made while building, the evidence.
3. `CONTEXT.md`, ADR-0015, 0016, 0017.
4. `src/evalrun.ts`, `src/evals.ts` and one finished results file (`plugins/aidw/roles/backend/evals/results.json`)
   for how Role evals run and are recorded.

Commands: `npm run typecheck`, `npm test`, `node plugins/aidw/bin/aidw roster`,
`node plugins/aidw/bin/aidw eval <role> [--case <name>] [--runs <n>]` (runs each case with `claude -p`, no tools,
grades each criterion, writes `roles/<id>/evals/results.json`; commit it with the Role's change).

## 2. State at handover

- `feat/rpi-upgrades` is pushed (PR #4, base `feat/factory-run-to-pr`, which is not yet in `main`).
- Typecheck clean; 113 test files, 2172 tests pass; `aidw roster` 0 errors, 1 warning (backend `results.json` is
  older than the Role's content because shared library text changed).
- Ten Role evals were added and validated by the roster, never run:

| Role | Case | Covers |
|---|---|---|
| research | describes-the-code-without-proposing | codebase-research |
| research | merges-parts-reading-only-contradictions | codebase-research (OP2) |
| research | brief-for-the-installed-version | docs-research |
| software-architect | answers-each-deferred-question | I9 |
| software-architect | opens-only-what-the-user-must-settle | D2, Q6 |
| software-architect | program-design-diffs-what-exists | program-design |
| documentation | walkthrough-page-without-script | library/html-pages |
| documentation | pr-summary-names-only-real-files | pr-summary |
| product-manager | before-after-as-the-user-sees-it | D1 |
| technical-planner | cut-from-the-program-design | task-interfaces |

  Two existing research evals were changed by T4 (`the-obvious-answer-is-wrong`, `worlds-not-competitors`).

## 3. Tasks

```text
V1 run evals ──── V2 fix failing cases ──┐
                                          ├── V4 owner merges #4, then factory-run-to-pr → main
V3 review PR #4 ─ fixes ─────────────────┘
V5 trial Change on a small existing project (after V4, or on the branch if the owner prefers)
```

**V1 run the evals (paid).** Ask the owner before the first run: it spends tokens. Run each Role with `--runs 3`
(the backend Role's level 1 results use 3 runs; a case passes only when all three pass), Roles in parallel, one
Bash call per Role, in the background. Also `aidw eval backend --runs 3` to clear the stale warning. Commit each
`results.json` on `feat/rpi-upgrades` (`test(roles): <role> results ...`).

**V2 fix failing cases.** For each failing case, read the answer and the failed criteria, then decide which is wrong:
the Role or Skill text (most often), or the case (a criterion that asks for something the decisions do not). Never
weaken a criterion to make it pass without saying why in the commit. One implementer subagent per Role with failures,
each in its own worktree as in `rpi-upgrades.md` section 3; rerun only the failing cases with `--case` and
`--runs 3`; a review agent checks that the fix follows the decision and copied no source wording.

**V3 review PR #4.** Run `/code-review` on PR #4 (ask the owner for the level), or a review agent per area if the
diff is too large for one pass: CLI (`src/`), Roles and Skills, Workflows and stages. Blocking findings are fixed on
`feat/rpi-upgrades` the same way as V2, with the full suite after each merge.

**V4 merge.** The owner merges. Only push fixes to `feat/rpi-upgrades` after asking: the push grant in
`rpi-upgrades.md` covered opening the pull request, not later pushes. After #4 merges, `feat/factory-run-to-pr`
→ `main` is the owner's decision too.

**V5 trial Change.** Run `/aidw:start` on a small existing project with one small feature, to exercise the new flow
end to end with real Agents: Existing System Report (neutral questions, parallel Research, merge), Before / After,
System Design round, Program Design, Docs Briefs in the plan stage, `patterns:`/`docs:`/`manual:`, the build with a
Research consultation if one comes up, `pr-summary.md` and "Checks for you". Record every point where the flow stalls,
asks something it should not, or produces an Artifact that `aidw analyze` refuses wrongly, in
`docs/plans/rpi-upgrades-trial.md`, one line each with the Artifact or command and what happened. Fix nothing during
the trial; the findings become the next plan.

## 4. How to run it (lessons from the rpi-upgrades run)

- Worktrees under `.worktrees/<task>`, branch `rpi/<task>` from `feat/rpi-upgrades`, `node_modules` as a symlink to
  `../../node_modules`. `git worktree add/remove` and `git commit` inside a worktree must run outside the sandbox.
- Implementers never commit `plugins/aidw/bin/aidw` (the symlink puts `../../node_modules` paths into the bundle);
  they restore it before committing. The lead rebuilds the bundle and runs `roster --write` in the main checkout after
  each merge (`scratchpad` script used last time: merge `--no-ff`, regenerate on conflicts in generated files only,
  commit a `build: regenerate ...` commit, then typecheck and the full suite).
- In the sandbox `npm`/`npx` can fail (safe-chain wrapper): use `./node_modules/.bin/tsc --noEmit` and
  `node scripts/build.mjs && ./node_modules/.bin/vitest run`.
- "Timeout calling onTaskUpdate" from vitest workers and timeouts in `conflict-edges`, `casesrunner`, `rulestable`
  appear only when several suites run at once; rerun the file alone. The serial run in the main checkout is the one
  that counts.
- About ten agents at once hit the account's usage limit last time; keep to six or fewer and resume stopped agents
  with a message rather than starting new ones.
- Questions for the owner go on an HTML page with selectable options and a copy-back summary (owner's preference).

## 5. Open points

Ask the owner before acting on any of these:

- Whether to spend tokens on V1, and on `--runs 3` or a single run first.
- The review level for V3.
- Which project V5 runs on, and whether it runs before or after the merge.
- Later items from `rpi-upgrades.md` (I12 `explain`, I13 `/aidw:amend`, D7, D8 `refactor`, R10) are not in scope;
  each needs an interview with the owner first.

## 6. Prompt for the new session

> Read `docs/plans/rpi-upgrades-verify.md` and the files it lists under "Read first". You are the lead. Ask me the
> open points of section 5 on one HTML page first. Then run V1 to V3 as section 3 and 4 describe: evals per Role in
> parallel, one implementer per Role with failing cases in its own worktree under `.worktrees/`, a review agent per
> fix, merge into `feat/rpi-upgrades` with the full suite after every merge. Ask me before every push and before any
> merge of pull request #4. Then run V5 as I decide and write its findings to `docs/plans/rpi-upgrades-trial.md`.
