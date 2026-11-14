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
- [ ] **Step 4.** Activate Planned Roles one at a time with their evals; Next.js and NestJS framework packs.

## Backlog

- Per-server MCP tier map (for example Vercel deploy as tier 3).
- Monorepo support: package-scoped touches, verify and layers.
- Headless evals (`claude -p`) asserting analysis artifacts and `aidw cost` budgets.
- `/aidw:amend` with a delta Analysis, only if trial shows that re-approval is not enough.

## Rejected

- `handoff` skill: aidw's code-built briefs already carry context from primary sources. An LLM summary in
  `$TMPDIR` would cost tokens and live outside `.aidw/`.
- `improve-codebase-architecture` in the pipeline: it needs a human, and nobody is there after approval.
