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
2. `aidw change new <id> --title "<title>" --input-type <idea|prd|upwork_jd|client_request|codebase>`
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

## 1c. Size

Decide with the user whether this is a **small** change (a bugfix or a tweak to one behavior) or a **normal** one, and
write `Size: small` or `Size: normal` in the Analysis Summary; the user confirms it at the gate. Small means:

- at most 3 grilling questions (only what the code cannot answer), no new domain model, design tokens or ADRs
  unless the change really needs one;
- at most 3 tasks, and `aidw analyze` refuses more;
- quality layers `code` + `unit`, plus `e2e` when UI is touched; deploy target `none` unless the user asked;
- a bugfix (`type: fix`) needs a regression test that fails first (its implementer brief says so).

Everything else (intake, specs, one gate, independent review, evidence) is unchanged.

## 2. Discovery (grilling + clarify)

1. `aidw transition <id> analyzing`
2. Read `$(aidw vendor-path pocock/grilling)` and run it: rounds over the decision frontier, numbered questions,
   each with your recommended answer.
3. Make sure the tree covers these ambiguity categories (Spec Kit *clarify*): users and roles, core flows,
   data and its lifecycle, edge cases and failure paths, non-functional needs (performance, security,
   accessibility, i18n), integrations, constraints (deadline, budget, hosting), and what is out of scope.
4. For a client JD the client is not here: the user answers what they know, and every remaining guess becomes
   an explicit **assumption** to put in the Analysis.
5. Record every round (questions, recommendations, answers) in `analysis.md` under
   `## Appendix: discovery Q&A` as you go.
6. Done when the frontier is empty and the user confirms you share an understanding.

## 3. Domain model

Read `$(aidw vendor-path pocock/domain-modeling)` and apply it, with this **adapter**:

- Glossary, entities, relationships and business rules go to `.aidw/domain/model.md` (sections
  `## Glossary`, `## Entities and relationships`, `## Business rules`). Use the glossary format in
  `$(dirname $(aidw vendor-path pocock/domain-modeling))/GLOSSARY-FORMAT.md`.
- ADRs go to `.aidw/decisions/NNNN-<slug>.md` in the format of `ADR-FORMAT.md` next to it. Not `docs/adr/`.

## 4. Requirements and specs

Read `$(aidw vendor-path pocock/to-spec)` and apply its synthesis (no new interview), with this **adapter**:

- Write `.aidw/requirements/<id>.md` with its template sections (Problem Statement, Solution, User Stories,
  Implementation Decisions, Testing Decisions, Out of Scope, Further Notes). Do not publish anywhere.
- Then express the behavior as **delta specs**, one per capability, at
  `.aidw/changes/<id>/specs/<capability>/spec.md`. Capability = a durable behavior area (`booking`,
  `identity/auth`), kebab-case, never the name of this work. Check existing ones with `aidw ids`.

Delta grammar (the CLI parses it; it is strict):

```markdown
## Purpose
<new capability only: what it is for, 50+ characters>

## ADDED Requirements

### Requirement: <one behavior>
The system SHALL <behavior>.

#### Scenario: <name>
- **GIVEN** <precondition>          (optional)
- **WHEN** <trigger>
- **THEN** <observable outcome>

## MODIFIED Requirements
<copy the WHOLE existing block from .aidw/specs/<capability>/spec.md, keep its header exactly, then edit>

## REMOVED Requirements
### Requirement: <exact existing name>
**Reason**: <why>
**Migration**: <what users or code do instead>

## RENAMED Requirements
- FROM: <old name>
- TO: <new name>
```

Every requirement needs at least one scenario; scenarios become the E2E and integration tests later.
Run `aidw validate <id>` and fix every error.

**Brownfield: lazy baseline specs.** Existing behavior has no spec yet, and aidw does not spec the whole
system. When this change modifies or removes behavior of a capability that has no `.aidw/specs/<capability>/`,
first run `aidw baseline <capability> --change <id>` and replace every `TODO(aidw)` in the skeleton with the
behavior the code has **today** (read the code and its tests; one requirement per behavior the change touches,
plus the neighbours it must not break). Then write the delta against it (`## MODIFIED Requirements` copies the
baseline block). The baseline is approved with the change and frozen while it runs. Capabilities the change
only adds to need no baseline. When a modified behavior has no test today, plan a first task that adds a
characterization test (it must pass on the current code) before changing it.

## 5. Design decision (Q3)

Detect design assets: Figma links, screenshots, an existing design system, brand guides. Then choose the
mode with the user. Read `$(aidw plugin-path profiles/design-tokens.md)` for how each mode produces tokens.

- `existing`: assets exist. Collect them into `.aidw/design/` (Figma via the Figma MCP tools, screenshots, notes)
  and extract the tokens from them (Figma variables, the brand guide, the live site's CSS).
- `claude_design`: the user designs in Claude Design. Ask them to export it ("Send to local coding agent")
  and save the bundle under `.aidw/design/`. Wait for it; this happens before approval. Take the tokens from the
  bundle's CSS custom properties / theme.
- `ai_design`: write `.aidw/design/direction.md`: personality, typography, spacing, key layouts, references,
  and the tokens. The user approves the look at the gate.
- `hybrid`: say which parts follow references and which parts AI designs; tokens cover both.

**Every mode ends with `.aidw/design/tokens.yaml`** whenever the plan has UI work (`aidw analyze` refuses the
package without it). Each token has a `use` rule saying where it must appear ("accent: Focus mode label, start
button, progress ring"). The `use` rules are what reviewers check on screenshots, so make them concrete. Show
the user the token table (name, value, use) as part of the Design discussion.

## 6. Architecture and stack

1. Read `$(aidw plugin-path profiles/stack-pool.md)` and apply its priority: **client > AI within the pool >
   fallback**. Record `Source: client|ai|fallback` and the reasons.
2. Write `.aidw/architecture/overview.md`: components, data model outline, folder structure, integrations,
   auth and payment choices.
   Read `$(aidw vendor-path pocock/codebase-design)` first and use it as design principles (deep modules, where a seam
   goes, the interface is the test surface), not as required vocabulary: the project's own `domain/model.md` terms win.
   For a task that creates a new module or interface, add `skills: [pocock/codebase-design]` in tasks.yaml so its
   implementer loads it; do not add it to every task (about 1.5k tokens each).
3. ADRs for hard-to-reverse, surprising, real trade-offs only (domain-modeling's rule).
   Brownfield: extend the existing architecture; record only what the change adds.
4. Fill `.aidw/constitution.md`: engineering principles and stack conventions every agent must follow.
5. Update `stack:` and `design_mode:` in `.aidw/project.yaml`.

## 7. Plan (task graph)

Read `$(aidw vendor-path pocock/to-tickets)` and apply its slicing rules (tracer-bullet vertical slices,
blocking edges, prefactor first, expand-contract for wide refactors), with this **adapter**:

- Do **not** quiz the user separately and do not publish tickets: the breakdown is reviewed at the gate.
- Write `.aidw/changes/<id>/tasks.yaml`:

```yaml
tasks:
  - id: T01
    title: <end-to-end behavior this slice makes work>
    role: fullstack-engineer   # fullstack-engineer | frontend-engineer | backend-engineer | database-engineer | qa-engineer | architect
    type: feat                 # Conventional Commits type of the task commit: feat fix refactor test docs style perf build ci chore revert
    specs: [<capability>/<requirement-id>]                 # from `aidw ids <id>`
    scenarios: [<capability>/<requirement-id>/<scenario-id>]
    depends_on: []             # blocking edges
    touches: ["app/(site)/booking/**", "lib/booking/**"]   # file globs this task may change
    risk: normal               # normal | high (high never runs in parallel)
    verify:
      - <command that proves it works, e.g. pnpm vitest run lib/booking>
    status: pending
```

- Every requirement and scenario marked `*` (changed) in `aidw ids <id>` must be referenced by some task.
- **Parallel waves.** Tasks whose `touches` do not overlap and whose dependencies are done run side by side,
  each in its own git worktree. Keep `touches` tight (exact folders, not `src/**`) so independent slices can
  run together, and list shared files (`package.json`, the root layout, a shared schema) only in the task
  that really changes them. `risk: high` (auth, payments, migrations, wide refactors) always runs alone. At
  most one task per wave may drive a browser (UI or e2e verify), since they share the e2e port.
- **Check the shape before the gate.** Run `aidw plan <id>`: it prints the stages (tasks that can run side by side
  are joined with `+`) and advice. Aim for a widest stage of 3 where the work allows. Split a task that carries a
  third of the scenarios (list / create / edit / delete are separate slices touching different files), and quote the
  one-line shape in the Summary so the user sees how long the build will take.
- **Every UI scenario has a UI owner.** A scenario whose WHEN is a user action on a screen ("the user clicks Export CSV")
  must be listed by a task that touches the UI files (and the API task may list it too). `aidw analyze` warns when
  its only owners touch no UI files; fix the plan, do not leave the button to chance.
- **Slice vertically, not by layer.** A plan that is one `depends_on` chain (T01 types, T02 API, T03 UI, T04
  tests...) can never run a wave. After scaffolding, cut the work into slices that each carry their own API,
  UI and tests for one behavior; give a task `depends_on` only for something it truly needs (a shared type or
  file it imports), not for "it comes next". `aidw analyze` warns when the plan is one chain or when
  `depends_on` links tasks whose `touches` do not overlap: act on that warning, or keep the chain when the
  dependency is real.
- The first tasks usually scaffold the project with the approved stack and set up the test harness, the
  JUnit reporters of quality.yaml, and `.env.example` for every environment variable (names only).
- **Code style and commits.** For a greenfield project the scaffold task also sets up the formatter, linter, hooks
  and commit lint of the project's **stack pack** (`$(aidw plugin-path profiles/stacks/node.md)` for JS/TS; the
  language-neutral rules are in `$(aidw plugin-path profiles/code-style.md)`); put those files in its `touches`
  and tell it to follow both. A stack without a pack gets the language's usual equivalents. Brownfield projects keep
  their own tooling.
- **Migrations.** A task that adds or changes a database migration is `risk: high` and follows the migration rule
  in `$(aidw plugin-path profiles/quality-layers.md)` (reversible, tested against a seeded database, additive first).
- **CI.** A greenfield project that will live on GitHub also gets `.github/workflows/ci.yml` from the scaffold task,
  mirroring the `code`, `unit` and `integration` layers (`$(aidw plugin-path profiles/ci.md)`). Brownfield keeps its own.
- **Test reports.** Every layer in quality.yaml with `reports:` needs its runner configured to write that JUnit file
  (Playwright `reporter: [['list'], ['junit', { outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT_NAME ?? '...' }]]`).
  Put it in the scaffold task's brief: a layer that passes without writing its report now fails verify.
- **Commits.** Every planned task states a `type` (analysis fails without one). The task commit becomes
  `type(capability): title`, the scope being the capability of its first spec (`config` when it has none), so
  a task spanning several capabilities lists the main one first. Add `breaking: true` only for a breaking change.
  Greenfield scaffolds commitlint with the same rules (the stack pack); see `docs/commit-guide.md`.

## 8. Quality, deploy and permissions

Read `$(aidw plugin-path profiles/quality-layers.md)` and `$(aidw plugin-path policies/permissions.md)`.

- Write `.aidw/changes/<id>/quality.yaml`: the layers with the exact commands for the chosen stack, the deploy
  target and command, the smoke checks, and the tier-2 resource keys. These commands run unattended after
  approval, so make them non-interactive.
- `## Quality profile`: which layers run and why, scaled to the project's risk (Q5: comprehensive by default).
  `code`, `unit`, `e2e` are expected. Add `ui-ux` (screenshots at three viewports + `review: ui`) and `a11y`
  (axe) whenever the change has UI; `security` (audit + secret scan + `review: security`) whenever it has
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
  and fixture in the quality-layers profile, "E2E browser over CDP"). Check now that this session reaches it:
  `node -e "fetch('http://127.0.0.1:9222/json/version').then(r=>r.json()).then(j=>console.log(j.Browser))"`.
  If it fails, give the user the Chrome command from the profile and check again. Write the CDP setup into the
  e2e layer and a Decision to honor (`E2E connects to Chrome over CDP at E2E_CDP_URL, default
  http://127.0.0.1:9222`). Use a launched browser instead only if the user prefers it and a real launch works
  in this session.
- **Parallel.** `parallel: { max: 3 }` in quality.yaml is the default (1 turns waves off). A wave task runs in
  `.aidw/run/worktrees/<change>/<task>`, inside the project, so dependencies resolve from the main checkout's
  `node_modules`. If the stack needs its own install per worktree, add an offline install as `parallel.setup`
  (e.g. `pnpm install --offline --frozen-lockfile`); a task whose setup fails runs sequentially instead.
- `## Permissions`: one bullet per tier-2 resource, starting with its key, e.g.
  ``- `vercel-preview`: preview deploy of the demo, deleted after handoff``, or `None`. `aidw analyze` checks
  that every key in quality.yaml is named here.

## 9. Analyze and present

1. Complete every section of `.aidw/changes/<id>/analysis.md`. Replace every `TODO(aidw)`.
   `## Decisions to honor` lists, as `- D1: <decision>`, every concrete choice the code must keep and a reviewer
   can check: names and keys (storage keys, routes, env var names), formats, tools and package manager,
   libraries, conventions, limits. Take them from the discovery answers, the stack, the architecture and the
   design. Implementers may not deviate from them without escalating, so be precise and include only real
   decisions. The `## Summary`
   must fit one page: goal, scope, the key decisions, and the risks and assumptions that need attention.
2. Run `aidw analyze <id>` and `aidw validate <id>`. Fix every error and re-run until both are clean.
3. `aidw transition <id> awaiting_approval` (it re-runs both checks).
4. Present to the user: the summary, the key decisions, risks and assumptions, requested permissions, and
   the plan size. Point them to `.aidw/changes/<id>/analysis.md` and tell them:
   `/aidw:approve` to approve, or tell you what to change.
5. **Stop.** Do not start building.

## Revising

If the user asks for changes while the change is `awaiting_approval`: `aidw transition <id> analyzing`,
revise, then repeat step 9.
