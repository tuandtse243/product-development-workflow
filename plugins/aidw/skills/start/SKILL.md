---
name: start
description: Start an aidw change from an idea, PRD, Upwork job description, client request or existing codebase, and run the whole Analysis up to the single approval gate. Use when the user runs /aidw:start.
disable-model-invocation: true
argument-hint: "<idea text | path to PRD/JD | 'this codebase'>"
---

# aidw: start a change and run the Analysis

The `aidw` CLI ships with this plugin as `${CLAUDE_PLUGIN_ROOT}/bin/aidw`. If a command fails with
`aidw: command not found`, run that path instead of `aidw` (here and in every command below).

You are running the **Analysis** of an Analysis-gated autonomous workflow. Everything you produce here is
reviewed by the user **once**, at the approval gate. After approval the workflow builds autonomously, so
the Analysis must be complete, consistent and honest about risks.

Input: `$ARGUMENTS` (an idea, a path to a PRD/JD, pasted client text, or "this codebase").

## Ground rules

- **Write files with the Write tool, never with a shell redirect or heredoc** (`cat > file <<EOF`, `echo > file`): the gate
  denies those before approval and each denial costs a turn. This holds for `intake.md`, `quality.yaml`, `tokens.yaml` and every file below.
- Until approval you may write **only inside `.aidw/`**. The aidw gate hook denies everything else. Do not
  scaffold, install packages or create source files. Read the codebase freely.
- All state changes go through the `aidw` CLI (on PATH while the plugin is enabled). Never hand-edit `state:`
  or `approval:` in `change.yaml`.
- **Never run `aidw approve`.** Approval is the user's decision and happens through `/aidw:approve`.
- Finding *facts* is your job: explore the repo or docs yourself (use an Explore subagent for wide searches).
  *Decisions* belong to the user: put them to the user and wait.
- Talk with the user in their language. Artifact content may be in their language, but keep every section
  heading and the `Source:` / `Mode:` lines exactly as specified: the CLI checks them.
- Vendored skills are loaded by path (`aidw vendor-path <upstream>/<skill>` prints it; then Read the file).
  Follow them, but the **adapter** notes below override where their output goes: there is no issue
  tracker; `.aidw/` is the tracker. Never run `/setup-matt-pocock-skills`.

## 0. Preconditions

Run `aidw status`. If it reports no `.aidw/`, follow `$(aidw plugin-path skills/init/SKILL.md)` first (it runs `aidw init`). If a change is
already `awaiting_approval` or later, tell the user and stop: one change at a time.

## 1. Intake

1. Pick a change id: `YYYY-MM-DD-<short-kebab-slug>` (today's date).
2. Pick the Workflow. The default follows the project (`product` for a new project, `feature` for an existing codebase); you
   only propose another: a **bug report** in an existing codebase is a `bugfix` and a request to **review** the code ("audit", "check", "is it secure") is an `audit` (see "Bugfix" and "Audit" below). Say which one you
   propose and why, and wait for the user to confirm it.
   `aidw change new <id> --title "<title>" --input-type <idea|prd|upwork_jd|client_request|codebase> --workflow <product|feature|bugfix|audit>`
   Always pass `--workflow`: it records the confirmed Workflow, and a `product` change gets its scope gate (step 2b) that way.
3. `aidw transition <id> intake`
4. Fill `.aidw/changes/<id>/intake.md`: paste the original request **verbatim** (or its path), record the
   client's explicit constraints, including any stack the client requires.

## 1b. Assessment (brownfield only)

When `.aidw/project.yaml` says `kind: brownfield` (or the input type is `codebase`), understand the existing
system before asking anything; the grilling then asks only what the code cannot answer.

1. The working tree must be clean (`git status`) and `aidw detect` must print no `WARNING` (no `.gitignore`,
   tracked or unignored `node_modules/`): aidw commits per task with `git add -A`. Ask the user to commit or
   stash first, and fix the warnings (see `/aidw:init` step 4).
2. Read `.aidw/project.yaml` (`stack`, `detected`), `aidw detect`, the README, `package.json` scripts, config
   files, the folder structure and the main flows. Read code; do not run the app yet.
3. Write what you found where it belongs: `.aidw/architecture/overview.md` (the architecture as it is, folder
   structure, integrations), `.aidw/domain/model.md` (entities and rules the code already has), and the
   conventions the code follows into `.aidw/constitution.md` (naming, folders, state management, styling,
   test style). These describe the current system; the change adds to them later.
4. **Health baseline**: run the existing checks that the quality layers will use (`detected.suggested_layers`:
   lint, typecheck, build, tests) once, now. Record which pass and which already fail. A check that fails
   before any change is not this change's fault: the user decides at the gate whether the change fixes it,
   or the layer leaves it out with a reason (`## Quality profile`).
5. Fill `## Existing system` in `analysis.md`: what exists, conventions to follow, the health baseline, the
   capabilities this change touches and what must not change.
6. Keep the stack: `Source: client` (the existing code is the client's choice, Q9). Never migrate frameworks,
   package manager or libraries unless the user asks for exactly that.

## 1c. Size, 2. Discovery (grilling + clarify)

These two steps are the **Interview** of the Product Manager Role, and they stay in this session because only you can
talk with the user. Read `$(aidw plugin-path roles/product-manager/role.md)` and follow its "Interview (main session)"
section: it decides the size (`Size: small|normal` in the Summary, which the user confirms at the gate), runs the
grilling and the clarify categories, and records every round in `analysis.md`. Start with
`aidw transition <id> analyzing`. The interview ends when the record is complete on disk: the drafting Agents below
read that record, not this conversation.

## 2b. Scope gate (`product` only)

A `product` change has a first approval before any requirement is written (`brief.md` exists in the change folder). Skip
this step for `feature`, `bugfix` and `audit`. It stops for the user:

1. Spawn **`aidw:product-manager`** with this prompt and nothing else:
   `Change <id>. The discovery interview is recorded in .aidw/changes/<id>/analysis.md. Write only the product brief, .aidw/changes/<id>/brief.md (vision, scope, MVP, out of scope), as your Procedure step 0 says, and reply with every decision still open.`
2. Settle open decisions with the user, as in step 3. `aidw transition <id> awaiting_scope_approval` refuses a brief that is still a skeleton.
3. Present the brief in a few lines (vision, scope, MVP, what is out) and tell the user: `/aidw:approve` to approve the
   scope, or tell you what to change (`aidw transition <id> analyzing`, revise, present again). **Stop.**
4. After the user approves the scope the change is back in `analyzing` (`aidw status` shows it). Continue with step 3.
   The final approval at step 9 is refused until the scope is approved.

## 3. Domain model, 4. Requirements and specs (drafting Agent)

Spawn the **`aidw:product-manager`** Agent with this prompt and nothing else:
`Change <id>. The discovery interview is recorded in .aidw/changes/<id>/analysis.md. Draft the domain model, the requirements and the delta specs as your Procedure says, run aidw validate <id>, and reply with the paths you wrote and every decision still open.`

It drafts in a fresh context from the recorded interview (its "Procedure (drafting)" in
`$(aidw plugin-path roles/product-manager/role.md)`: the domain model, ADRs, `.aidw/requirements/<id>.md`, the delta
specs and the brownfield baselines). Do not redo its work or read the artifacts back in full. Run
`aidw validate <id>`; for each open decision in its reply, ask the user, record the answer in `analysis.md`'s
discovery appendix and spawn the Agent again with the answer, until validation is clean and nothing is open.

## 5. Design decision (Q3)

Detect design assets: Figma links, screenshots, an existing design system, brand guides. Then choose the
mode with the user. Read `$(aidw plugin-path roles/ui-ux-designer/references/design-tokens.md)` for how each mode produces tokens.

- `existing`: assets exist. Collect them into `.aidw/design/` (Figma via the Figma MCP tools, screenshots, notes)
  and extract the tokens from them (Figma variables, the brand guide, the live site's CSS).
- `claude_design`: the user designs in Claude Design. Ask them to export it ("Send to local coding agent")
  and save the bundle under `.aidw/design/`. Wait for it; this happens before approval. Take the tokens from the
  bundle's CSS custom properties / theme.
- `ai_design`: write `.aidw/design/direction.md`: personality, typography, spacing, key layouts, references,
  and the tokens. The user approves the look at the gate.
- `hybrid`: say which parts follow references and which parts AI designs; tokens cover both.

Record the outcome as a Decision Point: `aidw decide design-needed <full-design|reuse-existing|no-ui> --reason "<why>"`
(`existing` -> `reuse-existing`; `claude_design`, `ai_design`, `hybrid` -> `full-design`; a change with no UI -> `no-ui`).
`aidw analyze` refuses `no-ui` when a task changes UI. The user sees every decision at the gate: `aidw decisions <id>`.

**Every mode ends with `.aidw/design/tokens.yaml`** whenever the plan has UI work (`aidw analyze` refuses the
package without it). Each token has a `use` rule saying where it must appear ("accent: Focus mode label, start
button, progress ring"). The `use` rules are what reviewers check on screenshots, so make them concrete. Show
the user the token table (name, value, use) as part of the Design discussion.

## 6. Architecture and stack

**Interview (this session).** The architecture is mostly decided from the requirements and the stack pool, so ask the
user only what they cannot answer: a stack the client requires, hosting, auth or payment providers, integrations,
limits. Read `$(aidw plugin-path roles/software-architect/references/stack-pool.md)` and put each question with your
recommendation. Record the answers under `## Stack` in `analysis.md` (`Source: client|ai|fallback` and why) before
drafting.

**Drafting Agent.** Spawn **`aidw:software-architect`** with this prompt and nothing else:
`Change <id>. The requirements and specs are drafted; the stack decisions are in .aidw/changes/<id>/analysis.md under "## Stack". Draft the architecture, ADRs, constitution and project fields as your Procedure says, run aidw validate <id>, and reply with the paths you wrote and every decision still open.`

Its Procedure (`$(aidw plugin-path roles/software-architect/role.md)`) holds the stack priority
(client > AI within the pool > fallback), `.aidw/architecture/overview.md`, ADRs, `.aidw/constitution.md` and the
`stack:` and `design_mode:` fields of `.aidw/project.yaml`. Handle its open decisions as in step 3.

## 7. Plan (task graph)

Spawn **`aidw:technical-planner`** with this prompt and nothing else:
`Change <id>. Requirements, specs, design, architecture and constitution are drafted. Break them into .aidw/changes/<id>/tasks.yaml as your Procedure says, run aidw plan and aidw analyze <id>, and reply with the number of tasks and waves and every decision still open.`

Its Procedure (`$(aidw plugin-path roles/technical-planner/role.md)`) holds the `tasks.yaml` format, who owns a task,
and the rules of a good plan (vertical slices, parallel waves, `aidw plan` shape, UI owners, commit types); its
`scaffold-tasks` and `migration-tasks` skills cover a new project and a migration. Handle its open decisions as in
step 3.

## 8. Quality, deploy and permissions

Read `$(aidw plugin-path roles/qa/references/quality-layers.md)` and `$(aidw plugin-path company/permissions.md)`.

- Write `.aidw/changes/<id>/quality.yaml`: the layers with the exact commands for the chosen stack, the deploy
  target and command, the smoke checks, and the tier-2 resource keys. These commands run unattended after
  approval, so make them non-interactive.
- `## Quality profile`: which layers run and why, scaled to the project's risk (Q5: comprehensive by default).
  `code`, `unit`, `e2e` are expected. **A change with UI always gets the `a11y` layer (axe through Playwright)**, even a small
  one: `aidw analyze` refuses a UI plan without it unless `## Quality profile` says why. Run `aidw detect`: when it shows no
  `a11y tests: axe-core`, the plan adds it, and that is the one dependency a small UI change may add even when the request says
  "no new dependencies" (a dev dependency for tests, never a runtime one): `@axe-core/playwright`, the `a11y` Playwright project
  and `e2e/a11y.spec.ts` go in the `touches` of the UI task (or the plan's first task), and you say so at the gate. Add `ui-ux`
  (screenshots at three viewports + `review: ui`) whenever the change has UI; `security` (audit + secret scan + `review: security`) whenever it has
  server code, auth, user data or a database; `performance` (Lighthouse budgets) for a public web app. The
  profile's "Recommended layers" section has the commands and the test files the scaffold task must add.
  Justify every layer you leave out; the quality report lists it as not covered.
- `## Deploy strategy`: none | local | preview, the provider, the preview environment variables and where their
  values come from. Production is never automatic: it is tier 3 and asks.
- **Environment preflight.** The layers run unattended in this Claude Code session, under its sandbox. Run
  `aidw doctor <id>` now: it checks the binaries of every quality command, the package manager, the package
  store and registry, Chrome CDP and the Vercel login and link. Settle every FAIL with the user before approval and
  record the WARNs under the Summary's risks: a layer that cannot run here fails in verify and escalates. Also
  check `npx lighthouse --version` yourself when the profile has a `performance` layer.
- **E2E browser.** Claude Code's sandbox usually blocks launching Chromium, so the default is **Chrome over
  CDP**: the user runs Chrome outside the sandbox with a debugging port, and Playwright connects to it (setup
  and fixture in the quality-layers profile, "E2E browser over CDP"). There is no fixed port: run
  `aidw browser start` (Chrome on a free port it picks, one profile per project) and check with `aidw browser status`.
  If the sandbox blocks the launch, ask the user to run `aidw browser start` in their own terminal and check again.
  Write the CDP setup into the e2e layer and a Decision to honor (`E2E connects to Chrome over CDP at E2E_CDP_URL,
  which aidw sets from aidw browser start; no default port`). Use a launched browser instead only if the user prefers it and a real launch works
  in this session.
- **Parallel.** `parallel: { max: 3 }` in quality.yaml is the default (1 turns waves off). A wave task runs in
  `.aidw/run/worktrees/<change>/<task>`, inside the project, so dependencies resolve from the main checkout's
  `node_modules`. If the stack needs its own install per worktree, add an offline install as `parallel.setup`
  (e.g. `pnpm install --offline --frozen-lockfile`); a task whose setup fails runs sequentially instead.
- `## Permissions`: one bullet per tier-2 resource, starting with its key, e.g.
  ``- `vercel-preview`: preview deploy of the demo, deleted after handoff``, or `None`. `aidw analyze` checks
  that every key in quality.yaml is named here.

## 9. Analyze and present

1. Complete every section of `.aidw/changes/<id>/analysis.md`. Replace every `TODO(aidw)`: read the file once, then write the
   whole completed file with **one Write** (keep every heading and the `Source:` / `Mode:` / `Size:` lines). One Edit per section
   is about twenty calls in a row, and the orchestrator's context is re-read on each.
   `## Decisions to honor` lists, as `- D1: <decision>`, every concrete choice the code must keep and a reviewer
   can check: names and keys (storage keys, routes, env var names), formats, tools and package manager,
   libraries, conventions, limits. Take them from the discovery answers, the stack, the architecture and the
   design. Implementers may not deviate from them without escalating, so be precise and include only real
   decisions. The `## Summary`
   must fit one page: goal, scope, the key decisions, and the risks and assumptions that need attention.
2. Run `aidw analyze <id>` and `aidw validate <id>`. Fix every error and re-run until both are clean.
3. `aidw transition <id> awaiting_approval` (it re-runs both checks).
4. Present to the user: the summary, the key decisions, the Decision Points and their answers (`aidw decisions <id>`),
   risks and assumptions, requested permissions, and the plan size. Point them to `.aidw/changes/<id>/analysis.md` and tell them:
   `/aidw:approve` to approve, or tell you what to change.
5. **Stop.** Do not start building.

## Bugfix

A change created with `--workflow bugfix` takes the small path (steps 1c to 9 with `Size: small`: at most 3 questions, at
most 3 tasks, no domain model, design tokens or ADRs; layers `code` + `unit`, plus `e2e` and `a11y` when UI is touched) with two
differences. The behavior is already specified, so the change has **no delta spec** (`skip_specs` is set for you), and the
planner writes a `type: fix` task whose regression test fails first on the current code (the implementer's brief says so).

**Skip the drafting Agents.** A defect has no new domain, requirements or architecture: do **not** spawn
`aidw:product-manager` or `aidw:software-architect`, and write no `requirements/` file, domain model, ADR or constitution change
(a run that spawned the Product Manager produced a requirements document and an extra Agent for a one-line fix). Do steps 1b to
2 and the health baseline yourself, then write the diagnosis into `analysis.md` in your one Write: the **root cause** (file and
line), the **scope** (what changes, what does not), the **Decisions to honor** (the exact response or behavior after the fix, what
must stay as it is), and the regression test the fix needs. The sections for Domain, Stack, Design, Architecture and Specs say
"n/a for a bugfix", and `aidw decide design-needed no-ui` records a fix without UI. Then spawn only the planner (step 7) with this
prompt instead of the one there:
`Change <id>. The diagnosis (root cause, scope, decisions to honor) is in .aidw/changes/<id>/analysis.md; there are no specs. Write .aidw/changes/<id>/tasks.yaml with one task of type fix (at most 3), with scope: <the capability it touches> and a regression test in its touches, run aidw plan and aidw analyze <id>, and reply with the number of tasks and every decision still open.`

The task's **regression test is proven by the CLI**: at its checkpoint aidw runs the new test files against the base commit, and a
test that passes on the old code fails the checkpoint.

There is **no approval gate** while the fix stays small. After `aidw transition <id> awaiting_approval` run
`aidw approve <id> --auto` instead of stopping:

- It approves itself (`approved by aidw (bugfix boundary)`; hash and drift protection apply as ever). Tell the user in
  one line what will be fixed, then continue with `/aidw:run`. A production deploy still asks.
- It refuses when the plan has more than 3 tasks, adds a migration or needs a delta spec. The change is now a `feature`
  change: present the package as in step 9 and stop for `/aidw:approve`.

## Audit

A change created with `--workflow audit` is **read-only**: no spec, plan, approval or build, and the gate stays closed to
project files for the whole change. Do not follow steps 1b to 9. Instead:

1. Intake as in step 1: write what to audit, and why, in `intake.md`. `aidw transition <id> intake`, then `analyzing`.
2. Choose the lenses with the user (`security`, `code-quality`, `ui`), recommending the ones the request implies, and
   record them: `aidw decide audit-lenses security,code-quality --reason "<why>"`.
3. For each lens: `aidw audit brief <lens>`. It prints the brief and the `SPAWN` line; spawn that Agent (`aidw:security`,
   `aidw:code-reviewer`, `aidw:ui-ux-designer`), all of them in one message, each with exactly the printed prompt. Each writes
   `.aidw/run/audit-<lens>.md` and replies with one line.
4. `aidw audit report`. It assembles `audit-report.md` (findings by severity, numbered `F-01`...). A lens that answered in a
   wrong shape is named: spawn that reviewer once more.
5. `aidw transition <id> delivered`, then `aidw archive <id>`. Present the report to the user: the counts, the critical and
   high findings, and what was not covered.
6. The user picks what to act on. `aidw audit picks F-01,F-03 --change <id>` prints the picked findings as the request of
   a new change; start it with this skill as a `bugfix` (a small, clear defect) or a `feature`.

## Revising

If the user asks for changes while the change is `awaiting_approval`: `aidw transition <id> analyzing`,
revise, then repeat step 9.
