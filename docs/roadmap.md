# aidw roadmap (review 2026-11-11)

Decided in a grilling session after a full plugin review. Order: batch 1 (safety and cheap fixes) → trial-3A →
batch 2 (features). Tick items as they land.

## Batch 1: safety and cheap fixes (before trial-3A)

- [x] **MCP gate.** The PreToolUse matcher also covers `mcp__.*`. MCP tools with read-like names
  (`get|list|search|read|fetch|whoami`) pass; every other MCP tool asks. Before approval, only read-like
  MCP tools are allowed. (A per-server tier map comes later.)
- [x] **Change branch.** Moving to `executing` creates `aidw/<change-id>` from the current commit, and task
  commits land there. If HEAD is already on a non-default branch, keep it and warn. Resume stays on the
  branch.
  Worktree task branches are renamed `aidw/<change-id>.<task>` (git refuses `aidw/<id>/<task>` beside `aidw/<id>`);
  session start warns when HEAD is off an unmerged change branch.
- [x] **Implementer report.** The implementer writes `.aidw/run/report-<T>.md` only when it has something to
  say: a file outside Touches, a scenario loosened or skipped, or a note for the reviewer.
  `buildBrief(review)` includes it as "Implementer notes".
- [x] **Vendor `pocock/codebase-design`.** `start` loads it in the Architecture step, and `tasks.yaml` lists it
  in `skills` for tasks that create a new module or interface. It is not loaded for every implementer.
- [x] **Agent limits.**
  - Implementer: `disallowedTools: WebFetch, WebSearch`, plus `maxTurns`.
  - Reviewer roles: the gate denies Bash commands that write (redirects, `sed -i`, `rm`, installs).
  - Changing reviewer models is measured in the trial first.
- [x] **Format fixes.**
  - `init`: description without trigger wording, and `start` no longer says "run /aidw:init".
  - `allowed-tools: Bash(aidw *)` on run, resume, status and deliver.
  - `plugin.json` `repository` is skipped: the repo has no remote yet. Add it when one exists.
  - The implementer's prettier line becomes "the project's formatter".
- [x] **Flaky retry.** A failed verify command runs once more. If it passes, evidence marks it `flaky`.
- [x] **Context after compaction.** PostCompact cannot inject context (the spec discards its output), so the
  existing `SessionStart` hook handles `source: "compact"` and prints the active change and its next step.
- [x] **Docs.** README and user guide state "one change at a time" and "monorepo not supported yet".
- [x] **Monorepo detection.** `detect` recognises `pnpm-workspace.yaml`, `turbo.json` and `nx.json`, and
  `init` warns.

## Trial-3A

- [x] Run trial-3A. It ran end to end on 2026-11-12 (8 tasks, 7 layers, deploy, archive); the run's findings are fixed
  ("fixes from trial-3A"). The pass/fail table in `docs/trial-3.md` was not filled in; the checks that matter are
  repeated in trial-3C.

## Batch 2: features (after trial-3A)

- [x] **Conventional commits.** aidw builds `type(capability): title` itself (`src/commit.ts`), every planned task has a
  `type`, and greenfield scaffolds commitlint ([ADR-0002](adr/0002-conventional-commits.md)).
- [x] **Trial-3A fixes.** Worktrees link the main node_modules; a layer that passes without its declared JUnit
  report fails; `analyze` warns when a UI scenario has no UI owner (and the reviewer checks it); `.pnpm-store` and
  `.vitest` count as junk; deploy hints for sandbox network and first-deploy-is-production; run preflight for
  installs and `vercel link`; implementers never idle on background work.
- [x] **Stack packs** ([ADR-0001](adr/0001-stack-packs.md)).
  - Create `profiles/stacks/node.md` and move the JS knowledge there (`code-style.md` merges in).
  - `src/git.ts` reads junk paths per stack.
  - Python and Go packs come when a real project needs them.
- [x] **`aidw doctor`.** Checks:
  - the binary of each `quality.yaml` command and the package manager;
  - CDP 9222 when a layer needs a browser;
  - `vercel whoami` for preview deploys;
  - the sandbox facts trial-3A hit: package store writable, registry reachable, deploy host allowed, `.vercel/project.json` present;
  - a clean tree on the change branch.

  Called from `start` §8, `run` §0, `resume` and the runner. It replaces the prose preflight.
- [x] **Small path.** `start` proposes `size: small | normal` and the user confirms at the gate. Small means:
  - at most 3 grilling questions;
  - no domain modelling, design tokens or ADRs;
  - at most 3 tasks;
  - layers `code` + `unit`, plus `e2e` when UI is touched;
  - a bugfix needs a regression test that fails first;
  - no deploy unless asked.
- [x] **Re-approval keeps done work.** Going back to `analyzing` after approval keeps done tasks and their
  evidence. Only new or edited tasks run. Document the flow.
- [x] **`aidw task reopen <T> [--revert]`.** It runs `git revert` on the task commit, sets the task back to
  pending and drops the evidence of layers that ran after it. Only the user or the orchestrator may call it.
- [x] **PR at deliver (opt-in, tier 3).** Push the change branch and run `gh pr create`, with the body
  following vendored `pocock/pr` (Summary, Evidence from checkpoints and screenshots, Merge Danger). Add
  Merge Danger to `handoff.md`.
- [x] **CI scaffold.** A workflow that mirrors the `code` and `unit` layers.
- [x] **Migration rule.** DB migrations must be reversible and tested against a seeded DB.

- [ ] **Trial-3C.** Run the checks #47–64 of `docs/trial-3.md` on a small change.
- [ ] Vendor `pocock/pr` (the sandbox blocked `api.github.com`; `aidw pr` builds the body itself meanwhile): `node scripts/vendor.mjs pocock` after adding `pr` to `scripts/vendor.config.json`.

- [x] **Token optimizations.** Implementer tool allowlist, reviewers on Sonnet, `aidw run` drops MCP servers, UI review rounds
  open only changed images, quality fixes with their own layer reviewer are auto-reviewed, orchestrator token discipline,
  `aidw cost` by role and parallel savings, `aidw doctor` warns about plugin overhead. Checks #65–69 of `docs/trial-3.md`.
- [ ] Skill digests: 1–2 KB checklists of the vendored addy skills (each full SKILL.md is 10–21 KB, read by every implementer and
  kept in its context). Only if trial-3C shows implementers still dominate the cost.

## Factory (decided 2026-11-14, awaiting approval of the design)

aidw becomes a software factory with a Roster of Roles, Workflows as data and declared Decision Points:
[`factory-architecture.md`](factory-architecture.md), [ADR-0003](adr/0003-cli-owns-flow-declared-decision-points.md),
[ADR-0004](adr/0004-role-folders-are-the-source.md).

- [x] **Step 1.** `roles/` for the 21 Roles, `roster.yaml`, agents generated from `role.md`. No behavior change.
  Checked on the demo (`scripts/make-demo.mjs`, 2026-11-14): `/aidw:start`, approval, two tasks with `aidw:fullstack` and
  `aidw:code-reviewer`, three layers, converge and archive all ran on the new paths. The same run showed that headless
  `/aidw:resume` could not reach the run loop; fixed (it reads `skills/run/SKILL.md` by path) but not yet re-run.
  Also in step 1: a test browser per project on a free port (`aidw browser`, hosted by the runner), authoring Roles
  (`access: artifacts`) kept inside `.aidw/` by the gate.
  - [x] `roster.yaml` (21 Roles), `tiers.yaml`, `aidw roster`, agents generated at build; the four existing agents are
    Roles (`fullstack`, `code-reviewer`, `security`, `ui-ux-designer`); the gate reads a Role's access from its profile.
  - [x] Profiles for the five other active Roles (`product-manager`, `software-architect`, `technical-planner`,
    `frontend`, `backend`). The knowledge of `/aidw:start` sections 2 to 4, 6 and 7 moved into them; the skill now
    points at the profiles. `access: artifacts`, a skill index and `includes` added to profiles.
  - [x] Profiles for the 12 Planned Roles (responsibility, boundaries, what to write before activating).
  - [x] `profiles/`, `policies/`, `vendor/` moved: stack packs to `stacks/`, permissions to `company/`, shared text and
    `vendor/` to `library/`, and the references each Role uses to `roles/<id>/references/`.
- [x] **Step 2.** `product` and `feature` Workflows as YAML drive `aidw next`; `artifacts.yaml`; interview in the
  main session, drafting in worker Agents.
  - [x] A: `artifacts.yaml` and `reads` / `writes` in the profiles; `aidw roster` checks owners and what each Role writes.
  - [x] B: `workflows/product.yaml` and `feature.yaml` describe the flow that exists today (no new stage);
    `aidw roster` checks them against the roster, `artifacts.yaml` and the state machine. The CLI now reads the Change
    state machine (`transitions:`) and the Agents it spawns (build stage `agents:`) from `product.yaml`; the task
    order of `aidw next` is scheduling and stays in code.
  - [x] Interview in the main session, drafting in worker Agents: `/aidw:start` interviews as the Product Manager and the
    Software Architect (answers recorded in `analysis.md`), then spawns `aidw:product-manager`, `aidw:software-architect`
    and `aidw:technical-planner` to draft. Design (step 5 of the skill) and the brownfield assessment stay in the main
    session. Not yet run end to end: a run on `~/aidw-demo` is the check.
- [x] **Step 3.** Decision Points, triage, Slice shape; `bugfix` and `audit` Workflows.
  - [x] Slice shape: a task runs with the Agent of its `role` (`aidw:fullstack`, `frontend` or `backend`; a Planned Role runs
    through the Role that carries it); `aidw analyze` warns when the plan names a Role that cannot run tasks.
  - [x] Triage (section 12, point 6 and the user's point 4): a task out of attempts is diagnosed once by `aidw:software-architect`
    (`aidw brief <T> --for triage`, `aidw triage <T>`); `implementation` grants one more attempt, `environment`, `plan`, `spec`
    and `architecture` escalate with the diagnosis. Not yet run with a real Agent.
  - [x] State machine per Workflow: `transitions`, `approval_required` and `analysis_required` live in each `workflows/<id>.yaml`
    (`src/machine.ts`); `product`, `feature` and `bugfix` walk the same machine, so behavior is unchanged. Needed by `audit` and
    the scope gate.
  - [x] Decision Points (ADR-0003): `decisions:` in a Workflow file, `aidw decide` / `aidw decisions`, answers in `decisions.yaml`
    (part of the approved package); `design-needed` in `product` and `feature`. `aidw analyze` refuses `no-ui` with UI tasks.
  - [x] Scope gate of `product` (Approval Gate 1): state `awaiting_scope_approval`, `brief.md` (vision, scope, MVP, out of scope),
    `aidw approve` approves the scope, `awaiting_approval` is refused until it is approved and again if the brief changed.
    A change gets it when created with `--workflow product`; one created without `--workflow` keeps the single gate.
    **Replaced (ADR-0011):** the scope is now a round of the discovery interview (`scope` Decision Page, recorded under
    `### Scope round` in `analysis.md`, checked by `aidw analyze`); a Change left in `awaiting_scope_approval` is read as
    `analyzing` and its `brief.md` stands in for the round.
  - [x] `audit` Workflow (read-only; its own machine: analyzing -> delivered, no approval): `aidw decide audit-lenses`, `aidw audit
    brief|report|picks`; reviewers write `.aidw/run/audit-<lens>.md`, the CLI assembles one report by severity. `performance` joins
    when its Role is activated. Not yet run with real Agents.
  - [x] `bugfix` Workflow (`workflows/bugfix.yaml`, chosen per request): `aidw approve <id> --auto` approves a small fix itself
    (at most 3 tasks, no migration, no delta spec) and reclassifies a bigger one to `feature`; `aidw change new --workflow`.
    Not yet run end to end.
  - [x] Bugfix hardening (from the first real bugfix run): a `type: fix` task's checkpoint copies the new test files onto the base
    commit and runs the unit verify commands there (`proveRegression`: `red`, `not-red` or `unproven`; `not-red` fails the task;
    evidence field `regression`). When `git worktree add` is not allowed (a sandbox with a read-only `.git`), the old code is checked out as a plain copy (`git archive`; evidence `via: snapshot`) and nothing under `.git` is written. `start` does not spawn the product-manager or architect for a bugfix; only the planner runs. A task
    may carry `scope:` so the commit reads `fix(todos): ...` rather than `fix(config): ...`. Gap: a test that is red only because of
    a missing import still counts as red; e2e is not re-run on the old code.
  - [x] a11y: `aidw analyze` requires an `a11y` layer for a UI change; `aidw detect` reports axe-core; `start` installs it by default.
- [ ] **Step 4.** Activate Planned Roles one at a time with their evals; Next.js and NestJS framework packs.
  - [x] Role evals: every active Role ships at least one case (`roles/<id>/evals/<case>.md`: `## Input`, `## Criteria` with
    must / must not bullets); `aidw roster` fails an active Role without one.
  - [x] Case runner: `aidw eval [<role>] [--case <name>] [--model <m>]` (`src/evalrun.ts`) answers each case with the Role's agent
    instructions through `claude -p` (no tools) and grades the answer against the criteria in a second call. The model calls
    are injected, so the tests use a fake; it has not been run against a real model (the sandbox blocks `claude -p`).
  - [x] First planned Role activated: `database` (skills for Prisma, Drizzle and Supabase migrations, expand-contract, indexes and
    seeds; an eval case). A task with `role: database` now runs `aidw:database`. It took no CLI change: `roster.yaml`, the
    profile, its knowledge and the planner's text. `tests/activation.test.ts` repeats this for `api-designer`.
  - [x] Second planned Role activated: `devops` (skills for Docker and compose, and for a CI pipeline that mirrors the quality
    layers without leaking a secret; one case). A task with `role: devops` runs `aidw:devops`; it never deploys. Ten Roles
    stay planned. `qa` is held back on purpose: the CLI carries it (it runs and judges the layers), so an Agent would only
    duplicate it until there is a gap the CLI cannot close.
  - [x] Third planned Role activated: `integration` (skills for contract tests and external APIs; a case about one field that the
    server names differently from the contract). The planner now ends a split Slice with an `integration` task. Nine Roles stay
    planned; the tests now use `api-designer` to show that activation is data only.
  - [x] Framework packs `stacks/nextjs.md` and `stacks/nestjs.md` (front matter: the framework `aidw detect` reports and the Roles
    that read it). An implementer's brief points at the pack of the project's framework; `frontend` never gets NestJS. Adding a
    framework is adding one file.
  - [x] Two more packs for the other frameworks `aidw detect` reports as a full-stack framework: `stacks/nuxt.md` and
    `stacks/sveltekit.md`. Astro and React Router / Remix are detected but have no pack yet.
  - [x] Python: `aidw detect` reads `pyproject.toml` (PEP 621, Poetry, dependency groups), `requirements*.txt` and `Pipfile`
    (`src/pydetect.ts`, no TOML library), names the tool (uv, Poetry, Pipenv, pip), reports the stack (Django, FastAPI, Flask,
    SQLAlchemy, pytest, ruff, mypy...) and proposes the `code` and `unit` layers (`uv run ruff check .`, `uv run pytest`). A
    project with both `package.json` and Python files gets both test suites in the same layers. New packs: `stacks/python.md`
    (the stack pack) and the framework packs `django.md` and `fastapi.md`. Flask is detected but has no pack. Not yet run on a
    real Python project; the tests use synthetic ones.
  - [x] Findings of the first `product` run (a notes app from an empty folder, 2026-11-15): (1) `aidw doctor` said "all checks
    pass", then the scaffold's first `npm install` failed in 10 seconds: a package scanner (safe-chain) wraps `npm` as a shell
    function and timed out on its malware list, and a reachable registry proved nothing. Now `aidw doctor` runs a real install of
    a tiny package through the user's interactive shell (`src/installcheck.ts`; retried 3 times, a pass on a later try is a
    warning), `aidw transition <id> executing` refuses while it fails, and `aidw doctor <id> --fresh` re-checks in seconds
    instead of spawning an implementer to find out. (2) The Stop hook repeated the same "changed files" report on every turn of a
    stopped run (about a dozen times); it now reports a given state and file set once. (3) The scaffold task made the tables,
    so the `database` Role never ran: the migration check knew neither Drizzle's folder nor the schema file, and only warned.
    `src/dbpaths.ts` defines the database's paths once; `aidw analyze` now refuses a plan in which another Role changes them,
    or in which a `database` task also touches UI or API files, and the bugfix boundary uses the same definition. The planner's
    role carries the division as a table (scaffold, schema, data access, screens).

## Role upgrades (decided 2026-11-17, grilling session)

Goal: every Role works at lead or senior level. Decisions: [ADR-0005](adr/0005-skill-sources-vendored-and-authored.md)
(Vendored and Authored Skills) and [ADR-0006](adr/0006-guards-apply-to-every-project.md) (Guards on every project).
Each Authored Skill ships with at least one Role eval; each wave ends with a trial on the greenfield and brownfield
fixtures, compared with trial-3. Before writing any tool version or flag into a stack pack, check it against the tool's
own documentation (the research used secondary sources for TypeScript 7, pnpm 11 and tool versions). Read a Skill in
full before vendoring it.

### Wave 1: Guards, tooling and broken links

- [x] Vendor the five Addy `references/` files the vendored Skills link to (19 dangling links before).
- [x] Guard: test tampering and suppressions, a diff check at the task checkpoint (deleted or skipped tests, `.only`,
  `eslint-disable`, `@ts-ignore`, `as any`, `# noqa`); a violation fails the checkpoint, a suppression with a reason
  on its line goes to the reviewer. A task that removes a requirement sets `removes_tests: true`.
- [x] Guard: a rewritten snapshot and a changed test-runner or coverage config (where thresholds live) are listed
  for the reviewer; they do not fail the checkpoint, because a real change of behavior rewrites them too.
- [x] Guard: a task cannot change existing lint, tsconfig, CI or hook configuration unless its approved type is
  `build`, `ci` or `chore`; creating a missing file is allowed (so the scaffold task needs no exemption). A changed
  test-runner or coverage config goes to the reviewer. The gate denies `--no-verify` and `HUSKY=0`.
- [x] Guard: secrets scan of the lines a task added, at the checkpoint, and of the staged diff before aidw commits
  (built-in key formats, no scanner to install; `gitleaks:allow` marks a documented example).
- [x] Guard: install safety at the checkpoint for every package a task adds (npm, requirements.txt, uv.lock): it
  exists, is at least three days old (`AIDW_MIN_RELEASE_AGE_DAYS`) and has no known advisory, looked up on deps.dev.
  Without network the result is unproven and the reviewer is told.
- [x] Install safety before the install runs: pnpm `minimumReleaseAge` and `allowBuilds`, uv `exclude-newer`, in the stack packs.
- [x] Node pack: strict tsconfig flags; type-aware lint (oxlint on TypeScript 7, typescript-eslint strict on 6 and lower).
- [x] Node pack: focused and skipped tests are lint errors, `forbidOnly`; complexity limits. The Playwright lint plugin is
  left out on TypeScript 7: it needs the typescript-eslint parser, which does not support it.
- [x] Node pack: react and jsx-a11y rules through oxlint; knip and dependency-cruiser in the `code` layer.
- [x] Python pack: extended Ruff rules and pyright strict; deptry and import-linter.
- [x] Squawk and Prisma/Django/Alembic drift checks when a task changes a migration (Drizzle: regenerate and compare).
- [x] zizmor, actionlint and hadolint when a task changes a workflow or a Dockerfile.
- [x] Coverage on the diff: `aidw diff-coverage` reads an LCOV report, 80% of the lines the Change added.
- [x] oasdiff and schemathesis documented as layer commands for a project with an OpenAPI file.
- [ ] Framework packs still describe ESLint; bring Next.js, NestJS, Nuxt and SvelteKit in line with the Node pack (wave 3).
- [ ] Run the wave's trial on the greenfield and brownfield fixtures and compare with trial-3.

### Wave 2: reviewer, security, database, devops and the shared Skills

Every vendored Skill was read in full first. What differs under aidw, and the statements in them found to be wrong,
are in `library/vendored-skill-notes.md`; a brief that loads one of these Skills points to the notes.

- [x] Vendored, loaded by signal: obra `verification-before-completion` (core set), `systematic-debugging` (a retry or
  a quality fix; it replaces Addy's debugging skill in the selection), `receiving-code-review` (after a `fix` verdict);
  Addy `observability-and-instrumentation` (a task about logs, metrics or traces).
- [x] Authored, `code-reviewer`: `task-review`, spec compliance then code quality, with a silent-failure checklist.
- [x] Authored, `security`: `security-review`, trace each entry point and report only what can be exploited.
- [x] Vendored, `database`: supabase Postgres best practices (any task that touches the data layer). Migrations are
  covered by the authored `schema-evolution` Skill (wave 4, `database-architect`), which the `database` Role also loads.
- [x] Vendored, `devops`: docker `docker-project-foundations`, `docker-build-strategies`, `docker-compose-patterns`;
  Sentry `gha-security-review` (the review of a task that changes a workflow).
- [x] Authored, `integration`: `resilient-integration`, webhooks, idempotency, retries and timeouts.
- [x] Authored, shared: `aidw/api-design-rules` in `library/skills/` (error shape, lists, repeated writes, compatibility).
- [ ] Not done: Addy `source-driven-development` (its core step needs web access the Agents do not have); obra
  `writing-good-tests` (no such Skill upstream: the material is a file inside its TDD Skill, which overlaps Addy's);
  Playwright best practices (documentation, not a Skill); the CC BY-SA lookup directory (Sentry security references,
  ASVS chapters). Decide each with the wave's trial.

### Wave 3: framework packs and the upstream Roles

- [x] A framework pack lists the Skills that load with it (`skills:` for the Roles that build, `review_skills:` for the
  review); a test checks that each one exists. No framework is named in `src/skills.ts`.
- [x] Vendored per pack: FastAPI's own Skill (FastAPI); Svelte's core best practices (SvelteKit); Vue best practices
  (Nuxt, with a note that Nuxt's conventions win); Sentry `django-perf-review` (review of Django code). Astral `uv` and
  `ruff` load when a task touches `pyproject.toml` or `uv.lock`.
- [x] Authored, shared: `aidw/react-rules` (Next.js pack; ideas: Vercel, no licence file) and `aidw/nestjs-rules`.
- [x] Authored, `product-manager`: `discovery-frame` (jobs to be done), `behavior-map` (the journey, thinnest runnable
  Slice first), `assumptions-premortem` (before the Approval Gate). The ambiguity scan and requirement quality with EARS
  go to `business-analyst` (wave 4); until that Role is active, `product-manager` carries them.
- [x] Authored, `software-architect`: `architecture-spine`, the invariants every implementer must keep.
- [x] Authored, `technical-planner`: `task-interfaces` (Produces, Consumes and Review focus per task). Pocock
  `to-tickets` stays the base.
- [x] `ui-ux-designer`: authored `ui-review-rubric`. Vendored for the frontend Roles: anthropics `frontend-design` (a
  task that touches UI) and emilkowalski `animate` (a UI task about motion). Design tokens gain an optional `why`.
- [x] The Next.js, Nuxt and SvelteKit packs follow the Node pack's linter choice; Nuxt and SvelteKit say that
  `vue-tsc` and `svelte-check` decide the TypeScript major.
- [ ] Not done: antfu `nuxt` (it documents a Nuxt 5 prerelease, the pack is on Nuxt 3: re-vendor at a matching commit
  or move the pack first); Sentry `django-access-review` (its references derive from OWASP material under CC BY-SA,
  which needs the separate labelled directory); shadcn (no pack and no signal to load it yet); Astral `ty` (beta);
  token references (a token whose value points at another token).

### Wave 4: every Planned Role activated

All nine were activated in one pass (the user chose to test everything together afterwards), so the Roster has 21
active Roles and none planned. Each got its Procedure, Done-when, Stop-and-report, its Authored Skills and an eval.

- [x] One discovery interview in the main session, in stages (`product-manager`, `business-analyst`, `ux-research`);
  each stage loads that Role's Skill, answers are recorded to disk, and no stage asks again what an earlier one settled.
- [x] A Decision Point for each optional upstream Role: `research-needed`, `ux-research-needed` (decided by the Product
  Manager), `data-model-needed`, `api-contract-needed` (decided by the Software Architect). Not answered means none.
- [x] `qa`: `test-case-derivation`, `test-layer-choice`; writes `test-plan.md`, the layers of `quality.yaml` and the
  Quality profile. The main session keeps the environment preflight.
- [x] `business-analyst`: `rule-and-edge-elicitation`, `requirement-quality-check` (EARS), and `delta-spec` moved from
  the Product Manager. It owns the delta specs; the Product Manager keeps the domain model and the requirements.
- [x] `api-designer`: `rest-contract`, `breaking-change`; writes `openapi.yaml` (OpenAPI 3.1) or a typed action table,
  and `api-contract.md`.
- [x] `database-architect`: `schema-design-postgres`, `schema-design-mongodb` (MongoDB's own references vendored);
  writes `data-model.dbml` and `data-model.md`. `aidw/schema-evolution` is shared with the `database` Role and loads
  on any task that touches the data layer; its lock table was read from the PostgreSQL 18 documentation.
- [x] `performance`: `reading-budget-reports`, `query-cost-in-a-diff`; a quality layer may say `review: performance`.
- [x] `ux-research`: `journey-mapping`, `usability-requirements`; writes `journeys.md`.
- [x] `research`: `evidence-scan`, `feasibility-spike`; writes `.aidw/research/<id>.md`. The only Role with web access.
- [x] `release`: `release-notes`, `deployment-checklist`; writes `release.md` at delivery. It never deploys.
- [x] `documentation`: `readme-structure`, `api-docs-from-contract`; updates `README.md` and `.env.example` at delivery.
- [x] Implementer briefs point at the data model, the API contract, the test plan and the journeys when they exist.
- [ ] Not done: `qa` closing coverage gaps after the build (the converge step still finds them and adds tasks);
  `performance` as an audit lens; the analyze step checking the new Artifacts (a decision that says `design` with no
  `data-model.md` is not refused yet); `docs/factory-architecture.md` still describes some Roles as planned.

### Before any of this is trusted

Nothing above has run through a real Change. The unit tests cover the code (guards, skill selection, the roster,
workflows), not the behavior of the Agents with the new Skills.

- [x] Run the Role cases (the CLI's eval command): 21 Roles, 35 cases. Five failures in all: four fixed in the
  Skills (a rewrite that added behavior, the output order of the Postgres schema, a guessed workaround, a
  self-supplied refusal example) and one case moved to the business analyst with the delta specs. Each then passed
  3 of 3 runs; the full run after the first two fixes was 32/35.
- [x] Trial 4 (docs/trial-4.md): a greenfield app (13 tasks) and a brownfield change (11 tasks) ran end to end.
  Cost fell against trial-3 (an implementer's first turn is 10K to 12K tokens against 37K), attempts per task were
  1.38 and 1.27, and 1 review in 12 returned `fix` in each. Two Guards fired on real work: the tamper guard caught a
  skipped test (right) and a renamed test file (wrong, fixed: a moved test is not a deletion); the others never had
  to fire. Two more fixes came out of it: the ui review rubric (an approved token does not excuse a failing
  contrast ratio) and a doctor check for deps.dev. `scripts/guard-drill.mjs` runs every Guard on a real repository
  without a model.
- [ ] Still open from trial 4: row 74 (`--no-verify` denied by the gate); an existing test's assertion was weakened
  (`toHaveLength(1)` became `.length > 0`) and no Guard saw it: list removed assertions of existing tests for the
  reviewer; a replanned task is reset by hand in `tasks.yaml`, which loses its attempt count (`task reopen` only
  accepts a done task).
- [x] Watch the token cost of a brief: the core set grew by one Skill, UI tasks by one, data tasks by two.

Not chosen: timescale `postgres-database-migration` as a Vendored Skill (suspected errors, replaced by
`schema-evolution`), Addy `interview-me` and `planning-and-task-breakdown`, `deprecation-and-migration`, Trail of Bits
`differential-review` and `property-based-testing`, a lint hook after every edit, design-token lint, mutation testing,
Semgrep. Revisit mutation testing if a trial shows empty tests passing the coverage threshold.

## Design quality (decided 2026-11-18, grilling session)

The interfaces of the demo products were generic. The decisions are in ADR-0008 (the Design Mock) and ADR-0009 (the
Slop Check); the terms are in `CONTEXT.md` under Design. The three steps run in order, and a step starts only when
the owner has judged the one before it on before-and-after screenshots of the same products: `todo-board`
(`evals/demo/`, the baseline), an admin screen with a data table and charts, a landing page with a sign-up.

### Step 1: the design direction

- [x] Vendor Impeccable's rule catalog and craft floor (`library/vendor/impeccable/`); `scripts/vendor.mjs` copies
  single files and a notice.
- [x] Direction Library: three Design Directions, each accepted by the owner on a preview of `todo-board`
  (`roles/ui-ux-designer/references/directions/`): Night Shift, Playground, Riso. Not kept as examples:
  Workbench, Tide, Color Field, Transit (not banned from being composed).
- [x] The library is not dealt from (ADR-0008, amended 2026-11-18): three directions dealt to every product
  repeat. The accepted directions become examples of format and bar; the directions are composed per product.
- [x] Composing directions: `research` skill `world-scan` (worlds outside software with traits and cited pictures,
  and the conventions shared by three live products of the kind) and `ui-ux-designer` skill `compose-directions`
  (three directions in one context, each borrowing one whole world, no two sharing a world or three of six axes).
  A world may come back for another product or in another round; no record of worlds used is kept and no world is
  banned.
- [x] Authored Skill `build-design-mock` for the `ui-ux-designer`: one direction only, content inventoried as real,
  sample or absent, the plan as a comment at the top of `tokens.css`, first region first, checks in three tiers
  (floor, slop, finish) on screenshots, two rounds of fixes at most; extend mode adds up to two screens and the
  main screen's states. References `mock-files.md` and `render-check.md`; four Role evals. Sources: Hallmark,
  Impeccable, Anthropic `frontend-design`.
- [x] `aidw mock font` (OFL only, checked from Fontsource's metadata; latin, latin-ext and vietnamese; cached under
  `~/.aidw/cache/fonts`) and `aidw mock shots` (every page at 1440 and 390 px, light and dark, in the test browser
  over CDP; `--full` for landing pages).
- [ ] Wire the design stage of `/aidw:start` to these: `research` runs `world-scan` on every `full-design`, one
  `ui-ux-designer` Agent of the deep Tier composes, and the Role gets write access for mocks.
- [ ] `ui-ux-designer` as a worker Agent of the deep Tier for mocks: three in parallel, one direction each. The
  Decision Page shows a thumbnail and a link per mock. The chosen mock is extended to at most three screens.
- [ ] The Design Mock as an Artifact, frozen with the tokens (read from its CSS), its images and their credits.
  UI briefs point to it; the reviewer compares screenshots with it for structure and treatment.
- [x] Fonts: open licences only, fetched when the direction is composed and stored beside the mock (`aidw mock font`).
- [ ] Slop Check (ADR-0009): aidw's own detection for the rules it can measure, at the checkpoint and in the `ui-ux`
  layer; exceptions from `direction.md`. The failures of use become a Guard on every project. Change the
  reviewer's "taste is non-blocking" rule accordingly.
- [ ] Move `anthropic/frontend-design` to the Agents that build mocks; an Authored Skill tells a frontend Agent to
  build to the mock. `emil/animate` stays.
- [ ] References. Decision Point `references-needed` (decided by the `ui-ux-designer`): the `research` Role finds
  live sites of the same kind of product through a CLI script (Land-book, SaaS Landing Page, Lapa Ninja,
  Landingfolio, SaaSUI, SaaS Interface, component.gallery; only where `robots.txt` allows, a few pages a search),
  opens them and takes its own screenshots. Traits shared by at least three set the conventions of the kind of
  product (density, the screens it must have); the worlds, not these sites, set the look. A
  reference the user names (a link, an image, a Figma file; this is how Dribbble and Pinterest come in) is
  followed closely, with its name, mark, words, images and licensed fonts replaced.
- [ ] Images: chosen by the `ui-ux-designer` while building the mock, through a CLI script, from sources that need
  no key (Wikimedia Commons, Openverse, The Met; Open Peeps; Lucide; DiceBear's CC0 styles) and Pexels when a key
  exists. CC0, public domain and CC BY only, downloaded into the project with a credits file. What was found is
  kept in a catalog outside the project, by product domain (finance, health, ...), and reused before searching
  again. No realistic face stands in for a customer or a testimonial.
- [x] Vendor the lookup material for usability: Vercel's Web Interface Guidelines (`command.md`) and Impeccable's
  `clarify.md` and `harden.md`.
- [ ] Usability Rules: an Authored Skill of about a hundred rules in aidw's own words, each with its source and a
  fixed severity (blocking, fix, remark). A short core plus one reference per topic (forms, actions, navigation,
  feedback, states, tables, search, first run, dialogs and toasts, touch, wording, accessibility, landing pages),
  loaded only for what a screen has. Sources: WCAG 2.2, GOV.UK Design System, NN/g, Baymard, web.dev, Vercel,
  szilu/ux-designer-skill and Community-Access (as sources, not copied). Rules for flows no source covers (sign-up,
  sign-in, reset, wizards, settings, a refused permission, undo or confirm, bulk actions, autosave) are marked as
  aidw's own and never block unless data is lost. Folklore is listed as not a rule (three clicks, 7±2 menu items,
  the call to action above the fold, three plans with the middle one highlighted).
- [ ] Where sources disagree, the house choice: validate on leaving a field and on submit, never during a first
  attempt; mark required and optional fields both; a toast stays at least 5 seconds, can always be dismissed, and
  stays until dismissed when it carries an action; touch targets are 44 px, never under 24 px. The contested part
  of a rule is never blocking.
- [ ] Severity: blocking when the job cannot be done, data is lost, a WCAG A or AA criterion fails, or a Dark
  Pattern is present; fix for a missing empty, error or loading state and for a rule with evidence behind it;
  remark for single-source rules and conventions. On every project, on the screens the Change touches.
- [ ] The rules reach four Roles: `ux-research` (usability requirements), `ui-ux-designer` (the mock, the review),
  the frontend Roles (the build). Measure what each adds to a brief.
- [ ] Dark Patterns are not built: the `product-manager` names one when it appears in the requirements and proposes
  the honest form; the review blocks one that got through. Sample content marked as a sample is allowed.
- [ ] Review by flow in the `ui-ux` layer: the reviewer walks up to three journeys written by `ux-research` in the
  running app, by keyboard and at phone width, asking at each step whether the right action is visible, whether
  it is clear where it leads, and whether the result shows progress.
- [ ] Run `todo-board` again. Two separate measures: the owner judges the look on before-and-after screenshots; use
  is measured by the count of blocking and fix findings the same reviewer reports on the old and the new build.
  The three directions are composed for it, not taken from the library.

### Step 2: components and charts (React only)

- [ ] Decision Point `component-library` (decided by the `software-architect`); the shadcn family is the default in
  the React stack pack for structure (forms, tables, dialogs), and React Bits is the one effects registry for
  motion (text animations, animated components, backgrounds), installed through the same `shadcn` CLI
  (`@react-bits`). React Bits is installed into the project, never shipped in the plugin (Commons Clause). Its
  components are copied source: recolor them from the project's tokens, and give each a reduced-motion fallback.
- [ ] Motion is wanted, not rationed: the factory sets no cap on effect components, on landing pages or on app
  screens (animated backgrounds included). The `ui-ux-designer` writes in `direction.md` which effects go where,
  and that text is the exception that lifts the Slop Check's motion rules. Three limits stay whatever the
  direction says: a reduced-motion fallback, text over a moving background passes the contrast Guard, and the
  `performance` layer's budgets hold.
- [ ] Charts: Bklit by default (it reads the project's tokens), Recharts through shadcn `chart` when Bklit lacks a
  chart type or documented accessibility is required, EvilCharts only when the Design Direction asks for a showy
  look. Series colors are tokens. An Authored Skill for charts (which form, direct labels, empty and loading states).
- [ ] Run the admin screen product; the owner judges.

### Step 3: Brand

- [ ] Decision Point `brand-needed` (decided by the `product-manager` after asking the user):
  `name-and-logo`, `logo-only` or `none`.
- [ ] Name: an Authored Skill for the `product-manager`, right after the scope is approved. Six to eight candidates
  on a Decision Page, each screened (domain, package name, a web search for products of the same name) and marked
  "not checked" when the network refuses. Screening, not trademark clearance.
- [ ] Mark: SVG written by `ui-ux-designer` Agents after the Design Direction is chosen (geometric marks, monograms,
  wordmarks), shown large, at favicon size, on light and dark.
- [ ] The Brand as an Artifact (name, mark, favicon), frozen at the Approval Gate; the scaffold task puts it in the app.
- [ ] Run the landing page product; the owner judges.

Not chosen: Hallmark, Impeccable or Taste Skill vendored whole; Impeccable's detector; Astryx as the default
component family; Tremor (frozen); Unsplash (its API terms ask for non-automated use); automated access to
Dribbble, Pinterest or Behance (blocked, and forbidden by their terms). Deferred: Nuxt and SvelteKit component
families, a keyed vector model for marks (Recraft), paid reference sources (Mobbin, Refero), a curated image
catalog shipped with the plugin (only if the owner judges the found images poor).

## Backlog

- Per-server MCP tier map (for example Vercel deploy as tier 3).
- Monorepo support: package-scoped touches, verify and layers.
- Headless evals (`claude -p`) asserting analysis artifacts and `aidw cost` budgets.
- `/aidw:amend` with a delta Analysis, only if trial shows that re-approval is not enough.

## Rejected

- `handoff` skill: aidw's code-built briefs already carry context from primary sources. An LLM summary in
  `$TMPDIR` would cost tokens and live outside `.aidw/`.
- `improve-codebase-architecture` in the pipeline: it needs a human, and nobody is there after approval.
