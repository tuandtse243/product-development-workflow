# Plan and handover: one command, one gate, run to a pull request

Written 2026-11-24 after a seven-round interview with the owner. This file is the handover for the session that
implements it. Nothing in `src/` or `plugins/` has been changed yet; only `CONTEXT.md`, ADR-0011 to 0014, this
plan and `docs/research/backend-role.md` exist.

## 1. Read first

1. `CONTEXT.md` (vocabulary; new terms: Consultation, Deviation, Change Branch, Wave, Task Worktree).
2. `docs/adr/0003`, `0011`, `0012`, `0013`, `0014`. ADR-0014 replaces the part of ADR-0003 that sends a cause
   upstream of the gate to the user.
3. `docs/factory-architecture.md` sections 3 (a Role), 11 (evaluation), 14.
4. `docs/research/backend-role.md` for phase 3 (15 rules, 7 skills, 5 scripts, eval cases, overlaps).
5. `docs/commit-guide.md` (conventional commits, enforced by commitlint and husky).

Commands: `npm run typecheck`, `npm test` (builds, then vitest; 50 test files under `tests/`),
`node bin/aidw roster` (checks Roles, Workflows and Role cases; `--write` regenerates `plugins/aidw/agents/`).
Running the Role cases against a model costs tokens and is not part of `npm test`.

## 2. What was decided

**The run**

| # | Decision |
|---|---|
| D1 | Workflow + Decision Points choose the Roles; the lead (main session) coordinates; the CLI computes steps and checks evidence (ADR-0003 stands). |
| D2 | One command: `/aidw:start <request>`. After approval, more than 3 tasks switches to the runner by itself. |
| D3 | One Approval Gate per Workflow, after the plan (ADR-0011). The `product` scope gate becomes a round of questions in the discovery interview. |
| D4 | Before the gate: CLI checks, then one independent read-only review of architecture and plan, at most 2 fix rounds; open findings are listed at the top of the gate's Decision Page. |
| D5 | At the gate the user grants: push of the Change Branch and the pull request, draft included (ADR-0012); a wider permission envelope (any free resource of providers already in use; data-changing migrations on local and dev databases when reversible and tried on seed data); a cap on Agent runs (default 3 times the plan, editable). |
| D6 | After the gate the run never asks the user (ADR-0014). |
| D7 | An Agent that lacks information asks, never guesses: a Consultation through the Orchestrator, one level deep, at most 2 per Agent run; in the build an implementing Role may ask only the authors of the contracts it builds against (ADR-0013). |
| D8 | When something approved must change, the Role that wrote it decides (keep the purpose, smallest change, no new scope); the CLI checks, records a Deviation, reruns affected tasks. Additions to a contract or the plan that serve an approved scenario take the same path. |
| D9 | A task that fails after Triage goes back to the Role that caused it (plan, spec, architecture) and is run again, at most 3 times; then it and its dependants are marked not built and the rest carries on. An environment cause is marked at once. |
| D10 | Work outside the permission envelope is marked not built, never done. At the cap no new task starts and the run ends cleanly. |
| D11 | A merge conflict in a Wave goes to the `integration` Role; afterwards both tasks' checkpoints run again and the merge is reviewed; if that fails the result is dropped and the task reruns sequentially (today's behaviour). |
| D12 | The run always ends in a pull request: ready when everything passes, draft otherwise. It opens with three fixed sections: differs from the approved package; not built and why; needed from the user to finish. |
| D13 | Parallel at every level, computed by the CLI from reads/writes and Touches; reviewers first. |
| D14 | Never automatic: credentials outside the project's `.env`, anything that costs money, production deploys, deleting cloud data. |

**A Role (backend is the pattern)**

| # | Decision |
|---|---|
| R1 | Pass/fail checks stay in the CLI; a Role's measuring tools live in `roles/<id>/scripts/` as dependency-free Node `.mjs`, called by path through `aidw plugin-path`, tested under `tests/`, advisory only. |
| R2 | `rules.md` is a table: id, rule, "applies when", who checks (reviewer, script, CLI). The review brief of a task points at the `rules.md` of the Role that built it. Reviewers cite rule ids in findings. |
| R3 | A Role's own skills are listed in `role.md` with a load condition; the Agent decides. Each skill carries a right/wrong example pair. |
| R4 | The must-items of "What this Role knows" move to `rules.md`; `roles/fullstack/role.md` is repointed. |
| R5 | backend builds adapters to outside services; `external-api` and `resilient-integration` move to `library/skills/` and are listed for backend and integration. |
| R6 | backend gets all 15 rules (B1 to B15), 7 skills (S1 to S7; S7 only after its source is read and judged), 5 scripts, cases E1 to E8 plus the 2 existing. Rules and cases about a contract hole or a missing constraint say "ask, do not guess", not "stop". |
| R7 | Also in the Role: a boundaries and hand-off table, its own "Done when" and report template, `references/`, a Consultation list (api-designer, database-architect, software-architect), a human-reviewed lessons file. Outside the folder: audit of the brief a backend task receives; Stack Packs for Express, Fastify, Hono. |

**Role cases (the per-Role quality checks, `roles/<id>/evals/`)**

| # | Decision |
|---|---|
| C1 | Level 0 (CLI, no tokens): a case declares `covers: [B7, S4]`; `aidw roster` fails when a rule or a skill of a Role has no case. |
| C2 | Level 1 (answer only, today's kind): 3 runs, 3/3 to pass; FLAKY counts as not passed. A case may declare `expect: ask`; for it the CLI drops the "do not stop to ask" line and the short-answer check. |
| C3 | A new case must fail without the rule or skill it covers and pass with it; a case the bare model passes is rewritten or dropped. |
| C4 | Level 2 (a real task with tools, in a temp copy of a fixture repo, from a real brief): machine graders first (held-out tests, the Role's scripts, CLI checks), a model grades only the rest. Skill loading is checked here from the tool log (`must read` / `must not read`). Built right after backend. Needs its own short design before coding. |
| C5 | Level 4: the CLI prints per Role the first-attempt pass rate, most-broken rule ids and Triage causes from real Changes. |
| C6 | The cases of a Role must be run before merging a change under `roles/<id>/`; the CLI writes a result file into the repo and `aidw roster` warns when it is older than the Role's content. A tier is lowered only when level 2 passes on the cheaper model. |

## 3. How to run this plan: lead, test, review

The owner asked for one lead, one test agent and one review agent, with tasks in parallel where possible.

- **Lead** (the main session): owns this plan. For each wave it creates one git worktree and branch per task,
  briefs one implementer subagent per task with the task's section below, and merges finished branches into the
  integration branch in the order listed. It never marks a task done itself.
- **Implementers**: one subagent per task, each in its own worktree, test-first. (My reading of "tasks can run
  in parallel": the lead delegates the coding. If the owner meant the lead codes, run the tasks one at a time.)
- **Test agent** (one, fresh context per task): given only the task's acceptance criteria and the diff. It adds
  the tests the criteria need and are missing, runs `npm run typecheck` and `npm test` on the task branch and
  again after the merge, and reports pass or fail with output. It does not change `src/`.
- **Review agent** (one, read-only, fresh context per task): reviews the diff against this plan, the ADRs and
  the `CONTEXT.md` vocabulary; findings are blocking or note. A blocking finding goes back to the implementer.
- A task is done when: tests of its criteria exist and pass, the full suite passes after merge, the review has no
  blocking finding, and docs touched by the change are updated (`docs/user-guide.md`,
  `docs/factory-architecture.md`, the affected `skills/*/SKILL.md`).
- One branch and one pull request per task marked "PR" below. Commit freely on the branches; do not push or
  open a pull request without the owner's word.

Hot files that several tasks edit: `src/cli.ts`, `src/run.ts`, `src/quality.ts`,
`plugins/aidw/workflows/*.yaml`, `plugins/aidw/skills/{start,approve,run}/SKILL.md`. Tasks in one wave were
chosen to touch different areas of them; merge in the listed order and rerun the suite after each merge.

## 4. Tasks

File names are starting points found during the interview, not a complete list; confirm by reading.

### Wave 0 (sequential)

**T0 docs commit.** Done on branch `feat/factory-run-to-pr`.

**T1 fix: skill selection uses real Role ids; schema-evolution resolves.** PR 1.
- `src/skills.ts` line 104 and nearby compare with `backend-engineer`, `frontend-engineer`,
  `database-engineer`; the ids are `backend`, `frontend`, `database` (`src/run.ts` near line 351 already lists both).
- `aidw/schema-evolution` is selected for every data task but `plugins/aidw/library/skills/schema-evolution/`
  is empty; the text is in `roles/database-architect/skills/schema-evolution.md`. Read how the brief resolves a
  skill path, then make the selected skill resolve to a file that exists.
- Accept: a backend task with Touches `src/bookings/**` gets the API skills; a data task's brief names an
  existing file; a test fails if a selected skill does not resolve.

### Wave 1 (parallel: T2, T3, T4)

**T2 feat: grants at the Approval Gate.** PR 2. (D5, D14)
- Push + pull request (draft included) for the Change Branch to a named remote and base; the permission
  envelope; the Agent-run cap. Recorded in the approved package; shown on the gate Decision Page.
- Start at `src/pr.ts`, `src/policy.ts`, `src/gate.ts`, `src/approval.ts`, `src/quality.ts` (permissions),
  `plugins/aidw/company/permissions.md`, `skills/approve/SKILL.md`, `src/page.ts` (gate layout).
- Accept: with the grant, pushing the Change Branch and creating the pull request pass the gate hook without
  asking, only for that branch and remote; pushing a Task Worktree branch is still refused; every other tier 3
  action still asks; tier x is still denied; without the grant behaviour is unchanged.

**T3 feat: product scope is an interview round, not a gate.** PR 3. (D3)
- `plugins/aidw/workflows/product.yaml` (`scope_gate`, `awaiting_scope_approval`, the `scope-approval` gate),
  `src/machine.ts`, `src/change.ts` states, `skills/start/SKILL.md`, scope tests.
- Accept: `product` has exactly one Approval Gate; scope choices are asked on a Decision Page during discovery
  and recorded in the analysis; a Change already in `awaiting_scope_approval` is still handled.

**T4 feat: parallel analysis stages and reviewers.** PR 4. (D13)
- The CLI already knows each stage's `reads` and `writes`; compute which stages and which review layers may run
  at the same time and print them in one `NEXT:`. Reviewers first, analysis stages second.
- Start at `src/workflow.ts`, `src/parallel.ts`, `src/layers.ts`, `skills/run/SKILL.md`, `skills/start/SKILL.md`.
- Accept: two stages with no read/write overlap are offered together; a stage that reads another's output is
  not; at most one browser-driving piece of work at a time; `parallel.max` is honoured.

### Wave 2 (parallel: T5, T6, T7; after wave 1)

**T5 feat: one command, automatic runner.** PR 5. (D2) After T2.
- `/aidw:start` carries on through approval into the build; with more than 3 tasks it starts the detached
  runner (`aidw run <id> --detach --permission-mode auto`) itself. `/aidw:approve` and `/aidw:run` stay as
  entry points.
- Start at `skills/{start,approve,run}/SKILL.md`, `src/runner.ts`.
- Accept: documented in `docs/user-guide.md`; a test for the threshold decision.

**T6 feat: independent review before the gate.** PR 6. (D4) After T3 (same Workflow files).
- A read-only Agent of a Role other than the authors grades architecture and plan against a fixed list (every
  scenario has a task, no task outside scope, follows the constitution, no needless complexity); at most 2 fix
  rounds; open findings go to the top of the gate page. Which Role reviews is not decided: propose one to the
  owner (candidates: `code-reviewer`, `qa`) before building.
- Start at `plugins/aidw/workflows/{feature,product,bugfix}.yaml`, `src/analyze.ts`, `src/page.ts`.

**T7 feat: integration resolves a Wave's merge conflict.** PR 7. (D11) After T4 (same `parallel.ts`).
- Start at `src/parallel.ts` (today: drop the branch, rerun sequentially), `tests/merge.test.ts`,
  `roles/integration/`.
- Accept: on conflict the integration Role is briefed with both tasks; afterwards both checkpoints and a review
  of the merge run; any failure falls back to today's behaviour; the conflict is recorded for the Technical Planner.

### Wave 3 (T8 first, then T9 and T10 in parallel, then T11)

**T8 feat: Consultation.** PR 8. (D7)
- `consults: [..]` in the `role.md` front matter (`src/roles.ts`, validated by `aidw roster`); a request file
  the Agent writes; a CLI command that checks the pair, depth 1 and the budget of 2, records the Consultation
  and prints what to run; the answer is an Artifact; the asking Agent is resumed with it. With the runner there
  is no main session: design the resume for both modes before coding.
- Rewrite "Stop and report" in `library/implement-a-task.md`: ask first; the user is not the first stop.
- First pairs: ux-research, product-manager, software-architect ask research; technical-planner asks
  software-architect; backend, frontend, fullstack ask api-designer, database-architect, software-architect.

**T9 feat: Deviation.** PR 9. (D8, D10) After T8.
- The author Role edits its Artifact; the CLI checks what it can check (no approved scenario removed without a
  recorded reason, a contract difference classified as additive or breaking, a new task tied to an approved
  scenario), rehashes the approved package with the reason, lists the tasks to rerun, and appends to a Deviation
  record in the Change. Work outside the envelope is marked not built.
- Start at `src/approval.ts`, `src/tamper.ts`, `src/decisions.ts`, `src/run.ts` (drift handling).

**T10 feat: upstream fix loop and the cap.** PR 10. (D9, D10) After T8.
- After Triage, the causes plan, spec and architecture go to the author Role and the task reruns, at most 3
  times per task; then the task and its dependants are `not_built` and independent tasks continue. Environment:
  marked at once. Count Agent runs per Change; at the cap start nothing new and finish.
- Start at `src/run.ts` (triage, escalate), `src/tasks.ts`, `skills/run/SKILL.md`, `src/runner.ts`.
- `skills/run/SKILL.md` step 3 still says "fix rounds exhausted -> escalated: tell the user and stop", and T4 added
  "record no more verdicts" around it. Rewrite to ADR-0014: mark not built, record the group's other verdicts,
  carry on.

**T11 feat: the run ends in a pull request.** PR 11. (D12) After T2, T9, T10.
- `src/pr.ts`, `src/deliver.ts`: a ready pull request when all required layers pass, a draft otherwise; the body
  opens with the three sections, filled from the Deviation record and the not-built list. `/aidw:resume`
  finishes a draft.
- Make the push grant (T2) hold at delivery: today deliver runs `aidw archive` before `aidw pr --create`, and
  the grant only covers Changes still under `.aidw/changes/`. Open the pull request before archiving, or let
  the grant read the archived Change.

### Phase 3: backend Role (after wave 3; T12 first, then T13 to T17 in parallel)

**T12 feat: checkable rules and covered cases in the CLI.** (R2, C1, C2, C6)
- `src/roles.ts`: parse the `rules.md` table (unique ids, "applies when", checker). The review brief points at
  the builder Role's `rules.md`. `src/evals.ts`, `src/evalrun.ts`: `covers:` and `expect: ask` in the case front
  matter, the coverage check in `aidw roster`, a result file written by the case runner, a staleness warning.

**T13 backend `rules.md` and `role.md`.** (R2, R4, R6, R7) 15 rules from the research report with "applies
when"; boundaries table; Done-when and report template; `consults`; repoint `roles/fullstack/role.md`; replace
the Migrations paragraph with the ask rule.

**T14 backend skills.** Seven files, one implementer each is fine: S1 endpoint-test-matrix, S2
transactions-and-races, S3 repeat-safe-writes, S4 effects-after-commit, S5 server-logs-and-errors, S6
query-shape. S7: read getsentry `secret-serialization` (Apache-2.0) and report to the owner before vendoring.
Authored Skills end with Sources (ADR-0005); no copied text from sources that do not allow it.

**T15 backend scripts.** route-inventory (Node frameworks first), env-names, error-shape-probe, query-count,
leak-and-timeout-scan; each with tests under `tests/`.

**T16 backend cases.** E1 to E8 (E1 and E2 with `expect: ask`), each with `covers:`, each shown to fail
without its rule or skill (C3); run 3 times; commit the result file.

**T17 shared material.** Move `external-api` and `resilient-integration` to `library/skills/` (R5);
`roles/backend/references/` and `lessons.md`; audit what a backend brief contains; Stack Packs for Express,
Fastify, Hono.

### Phase 4 (each needs a short design with the owner first)

- **T18** level 2 cases (C4), first for backend, then frontend and fullstack.
- **T19** per-Role statistics from real Changes (C5).
- **T20 onward** the remaining 20 Roles, one at a time in this order: frontend, fullstack; code-reviewer,
  security, qa; technical-planner, software-architect; product-manager, business-analyst; the rest. Each:
  research, a Decision Page for the owner to pick rules, skills, scripts and cases, then build to the backend
  pattern.

## 5. Open points for the implementing session

- T6: which Role does the pre-gate review. Decided 2026-11-24: `code-reviewer`, with a new `plan-review` skill.
- T1: decided 2026-11-24: `schema-evolution` moves to `library/skills/` (done).
- T14 S7: decided 2026-11-24: vendor getsentry `secret-serialization` (@a582c51, Apache-2.0) word for word with a
  `vendored-skill-notes.md` entry; it loads for backend only on a narrow signal (a credential field added to a class
  or config, or a logger/span/error-context call taking whole objects), only the project's language reference; the
  security Role loads it in Phase 4; S5 names it as a source.
- T16 runs: decided 2026-11-24: C3 is shown per case (`aidw eval --without <all of the case's covers>`, 1 run) plus a
  bare baseline (`--bare`, 1 run); per-item ablation is a diagnostic only. Budget for this round: 100 model calls
  (level 1 60, per-case 20, bare 20); more needs the owner's word.
- C3 amended 2026-11-24 after the T16 runs: on the deep tier the bare model passed 4 of 10 backend cases and the
  rest failed only on details, also with their covers removed. There the bare and per-case runs are a diagnostic;
  "a case fails without what it covers" is required on the tier a Role would be lowered to (C6) and at level 2
  (T18), where tests, scripts and the CLI grade real behaviour.
- T8: how the asking Agent is resumed in runner mode. Decided 2026-11-24: the asker writes its question and a
  progress note into the request file; the CLI always writes a resume brief (original brief + note + answer
  path), so a fresh Agent of the same Role is the guaranteed path; continuing the live Agent with SendMessage is
  an optimisation the lead uses when the asker is still running in its session.
- Delivery: decided 2026-11-25: one pull request for the whole of `feat/factory-run-to-pr` (T1 to T17, H1 and the
  per-case digests), its body one section per task naming the task's merge commit; this replaces "one pull request
  per task" for this branch, because the tasks were merged in order and depend on each other.
- T18 design: decided 2026-11-25:
  - Fixture: a new `evals/fixtures/backend-api`: Express, TypeScript, PGlite (Postgres in-process) and vitest.
    Packages are installed once into a cache, and each run gets a fresh copy with no network.
  - Cases: pilot `team-comes-from-the-session` first. Once the harness works, `charge-once`,
    `email-after-the-order` and `two-requests-one-slot`.
  - Run: `claude -p` as the backend agent from the plugin, in the temp copy, with the real brief.
    - Tools: Read, Write, Edit, Glob, Grep and Bash. No network.
    - Limits: 25 minutes and 60 turns per run.
    - The `stream-json` tool log is kept.
  - Grading, in order:
    1. Held-out tests, copied in after the run.
    2. The backend scripts.
    3. The tool log (`must read` / `must not read`).
    4. A model grades only the criteria no machine can check.
  - Budget: the pilot spends at most 6 Agent sessions (1 case × 3 runs, 1 bare, 2 spare). More needs the
    owner's word.
- T18 pilot: done 2026-11-27, `team-comes-from-the-session` passes 3/3 at level 2. The owner approved each batch of
  sessions beyond the first 6: 18 sessions in all, plus 36 level 1 calls. No bare run was made.
  - The runs found harness defects, now fixed: `route-inventory` missed access tests written through helpers;
    sessions could not bind 127.0.0.1; sandboxed loops and `$(…)` commands were refused; reads through a `for` loop
    were missed.
  - The runs found one Role gap: the Agent kept quiet about the existing routes' `x-team-id` hole in 2 of 6 runs.
    The report's `Found:` line closed it.
  - Level 1 no longer digests the Role's scripts (it never shows them to the model). Level 2 still does.
  - Owed: `log-with-a-token` is 2/3 at level 1, twice. A run logs the provider error's message and code but no
    stack. Sharpen `server-logs-and-errors` with the next change to the backend Role, so that the 30-call rerun
    of level 1 is paid once.
  - Not yet proven: that the session sandbox blocks outbound network, and that `Read` deny rules stop a sandboxed
    `cat`. No run tried either.
- The cases of every other active Role have no `covers:` yet; T12 must not fail `aidw roster` for Roles that
  have not been upgraded (require coverage only once a Role's `rules.md` uses the table format).
- The owner prefers question rounds as an HTML Decision Page with options, examples and a copy-back summary,
  not questions in chat.

## 6. Prompt for the new session

> Read `docs/plans/factory-run-to-pr.md` and the files it lists under "Read first". You are the lead. Run the
> plan wave by wave as section 3 describes: one implementer subagent per task in its own git worktree, one test
> agent and one review agent per task, merge in the listed order, full suite after every merge. Start with T1.
> Do not push or open a pull request without asking me. When a task has an open point from section 5, ask me
> with an HTML page before building it.
