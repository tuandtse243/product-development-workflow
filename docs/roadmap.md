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

### Wave 4: activate every Planned Role, one at a time

Order: `qa`, `business-analyst`, `api-designer`, `database-architect`, `performance`, `ux-research`, `research`,
`release`, `documentation`. Each needs its Procedure, Done-when, Stop-and-report, the Skills and the eval its `role.md`
lists, then the `carried_by` line removed. After the ninth, the Roster has no Planned Role.

Across the wave:

- [ ] One discovery interview in the main session, in stages (`product-manager`, `business-analyst`, `ux-research`);
  each stage loads that Role's Skill, answers are recorded to disk, and no stage asks again what an earlier one settled.
- [ ] A Decision Point for each optional upstream Role (`research`, `ux-research`, `database-architect`,
  `api-designer`): it runs on a Change only when chosen there. An active Role does not run on every Change.

The Roles:

- [ ] `qa`: authored Skills for deriving test cases from scenarios and for choosing the layer per scenario.
- [ ] `business-analyst`: authored `rule-and-edge-elicitation` (example mapping) and `requirement-quality-check`
  (ambiguity scan, EARS). Ideas: Cucumber example mapping, spec-kit, cc-sdd.
- [ ] `api-designer`: authored `rest-contract` and `breaking-change`. Artifact: `openapi.yaml` (OpenAPI 3.1) when the
  Change has HTTP routes, a typed action table otherwise, both with `api-contract.md`. Ideas: Google AIP, Zalando,
  Azure guidelines, RFC 9457 and 9745, oasdiff.
- [ ] `database-architect`: authored `schema-design` for Postgres, `schema-design` for MongoDB (with MongoDB's own
  reference files vendored, Apache-2.0) and `schema-evolution` (expand and contract; check every lock level against the
  Postgres documentation before writing it). Artifact: `data-model.dbml` as the source, with `data-model.md` (access
  paths, decisions, entity diagram). Ideas: supabase, timescale, pgroll, MongoDB.
- [ ] `performance`: authored Skills for reading budget reports ranked by impact (never invent a measurement, say lab
  or field) and for finding N+1 queries and unbounded lists in a diff.
- [ ] `ux-research`: authored `journey-mapping` and `usability-requirements`. Ideas: NN/g, GOV.UK Service Manual,
  WCAG 2.2.
- [ ] `research`: authored `evidence-scan` (every claim cited, confidence stated) and `feasibility-spike` (a
  time-boxed throwaway that answers one question). Ideas: deanpeters, cited-research and deep-research skills.
- [ ] `release`: authored Skills for release notes from Conventional Commits and for the deployment checklist and rollback.
- [ ] `documentation`: authored Skills for README structure per project kind and API docs from the contract.

Not chosen: timescale `postgres-database-migration` as a Vendored Skill (suspected errors, replaced by
`schema-evolution`), Addy `interview-me` and `planning-and-task-breakdown`, `deprecation-and-migration`, Trail of Bits
`differential-review` and `property-based-testing`, a lint hook after every edit, design-token lint, mutation testing,
Semgrep. Revisit mutation testing if a trial shows empty tests passing the coverage threshold.

## Backlog

- Per-server MCP tier map (for example Vercel deploy as tier 3).
- Monorepo support: package-scoped touches, verify and layers.
- Headless evals (`claude -p`) asserting analysis artifacts and `aidw cost` budgets.
- `/aidw:amend` with a delta Analysis, only if trial shows that re-approval is not enough.

## Rejected

- `handoff` skill: aidw's code-built briefs already carry context from primary sources. An LLM summary in
  `$TMPDIR` would cost tokens and live outside `.aidw/`.
- `improve-codebase-architecture` in the pipeline: it needs a human, and nobody is there after approval.
