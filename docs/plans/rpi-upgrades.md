# Plan and handover: what aidw takes from rpi, as one Change

Written 2026-11-26 after a five-round interview with the owner about HumanLayer's `rpi` plugin (MIT,
github.com/humanlayer/skills, `plugins/rpi`) and anthropics/html-effectiveness (MIT). This file is the handover for
the session that implements it. Only `CONTEXT.md`, ADR-0015 to 0017, the roadmap entry and this plan exist; nothing
in `src/` or `plugins/` has been changed.

Everything below ships as **one Change**: one branch, `feat/rpi-upgrades` (cut from `feat/factory-run-to-pr`), built
from start to end in one run, with as much in parallel as the task graph allows, and one pull request at the end.

## 1. Read first

1. `CONTEXT.md`. New terms: System Design, Program Design, Design Question, Pattern to Follow, View, Existing System
   Report, Docs Brief.
2. `docs/adr/0005` (vendored and authored Skills), `0011`, `0013`, `0014`, then `0015`, `0016`, `0017`.
3. `docs/plans/factory-run-to-pr.md`, sections 3 and 4, for how the last plan was run and which files are hot.
4. The sources, read in full before vendoring or authoring: rpi `skills/rpi/references/**` and `agents/*.md`,
   humanlayer `plugins/show-me`, html-effectiveness `*.html`. Take ideas, not wording, for every Authored Skill and
   name the sources in its `Sources` section.
5. `docs/commit-guide.md` (conventional commits, enforced by commitlint and husky).

Commands: `npm run typecheck`, `npm test` (builds, then vitest), `node bin/aidw roster` (`--write` regenerates
`plugins/aidw/agents/`), `node scripts/vendor.mjs <upstream>` (vendors from `scripts/vendor.config.json`).
`plugins/aidw/bin/aidw` is a bundled file: rebuild with `npm run build` and commit it with the source change.

## 2. What was decided

Ids are the interview's; they are cited in commits and in the pull request.

**Writing and the library**

| Id | Decision |
|---|---|
| I6 | Sub-headings in free sections state a finding ("Workers restore pending jobs before new work"), prose follows plain rules, and the author makes one pass to shorten and show instead of tell. Headings the CLI checks stay as they are. |
| I7, Q6 | Vendor `show-me` (humanlayer) and all 20 html-effectiveness examples word for word (ADR-0005). |
| Q8, Q8a, Q8b | Two separate Skills, each in `library/` for Roles and each a user command: `/aidw:show-me` (vendored) and `/aidw:html-pages` (Authored: which example fits which kind of page and what to take from it). show-me is used for every question put to a user or client; html-pages for every HTML page, whether the CLI or an Agent builds it. |
| I10 | Implementers follow a precedence when documents disagree: brief and `tasks.yaml` > ADRs and architecture > Program Design > specs > requirements > analysis > intake. A mismatch is reported in three lines: Expected, Found, Why this matters. |
| D5 | Every technical recommendation cites evidence: a path and lines from the Existing System Report or the code, or a source for greenfield. |
| D6 | `## Decisions to honor` and settled Design Questions record what was chosen, why, and why the other options were not. |
| I9 | `analysis.md` gets `### Deferred to architecture`: technical questions raised during discovery; the Software Architect answers each line. |

**Research (ADR-0016)**

| Id | Decision |
|---|---|
| I1, Q1 | Existing System Report: `.aidw/changes/<id>/existing-system.md`. `## Existing system` in `analysis.md` becomes its summary and points to it. |
| Q2 | Written by the Research Role (tier standard) with a new Skill `codebase-research`. |
| Q3, M10 | The orchestrator writes 2 to 7 neutral questions about today's code (never the request), groups them, spawns one Research Agent per group in parallel; each writes a part; one more Research Agent merges, writes the summary and checks contradictions against the code only where parts disagree. |
| I2 | `codebase-research` has four modes: locate (where), analyze (how it runs, file:line), patterns (code to imitate, with its tests), synthesize. Describe only: no critique, no proposals. |
| I4 | For each touched capability the report records how it is tested (files, fixtures, mocks), and separates tests read from checks run (a passing check carries its command and output). |
| M1, M2 | Greenfield skips the report. `bugfix` and `Size: small`: at most 3 questions, one Agent. |
| R1 | New Skill `docs-research` writes a Docs Brief: Question, Answer, Evidence table, Pitfalls, Not found. |
| R2, M12 | Source ladder for every Research Skill: 1 official docs of that version; 2 changelogs, migration guides, maintainers' issues and examples; 3 named experts and organisations (at most medium confidence); 4 forums and blogs, leads only. AI-written and copied pages are excluded. |
| R3 | Read the installed version first (lockfile, or the stack in the architecture); each claim names the version it holds for; newer docs that differ go to Pitfalls. |
| R4, Q-R2 | Order: a configured docs MCP server, then `/llms.txt` and the Markdown pages it lists, then HTML. WebFetch only, never curl. |
| R5 | "Best practice" only when the official docs recommend it or two independent sources of tiers 1 to 3 agree; always search pitfalls, anti-patterns and known issues. |
| R6 | The claim table gets a Quote column (at most two sentences) and a link to the section anchor. |
| R7 | Search budget: 2 to 3 searches and 3 to 5 pages first, then refine; exceeding it is explained. Query patterns per kind (API, best practice, error, comparison), `site:` for official domains. |
| R8, M13 | The planner adds `docs: [<lib>@<version> <topic>]` to a task that uses a library or service new to the project or sensitive to its version; Research writes the Docs Brief before the gate; the brief inlines its Answer and Pitfalls; the gate's plan section lists them with links. |
| R9, Q-R3 | Docs Briefs live in `.aidw/research/docs/<lib>@<major.minor>-<topic>.md` and are reused while major.minor matches and they are at most 90 days old. |
| Q-R1 | An implementing Role may consult Research at most once per task (amends ADR-0013). |

**Design and questions (ADR-0015, ADR-0017)**

| Id | Decision |
|---|---|
| D1 | `## Before / After` in the Summary (3 to 6 lines each, as the user sees it); first section of the gate page. Brownfield takes Before from the Existing System Report; greenfield from today's workaround. |
| D2, Q6 | The Software Architect returns as open a Design Question that is hard to reverse, whose options are about equal, or that changes cost or operation; at most 5 per round; it settles the rest with reasons (D6). |
| D3, Q1, Q7, M9 | After the System Design: a round of questions (Decision Page `system-design`), not a gate. With nothing open, one question in the chat with a summary, a link and a View. |
| I5, Q2, Q3 | Then the Architect's second run writes `program-design.md`: required a file-tree diff and the main signatures and contracts; optional call trees, component trees, dependency maps, pseudocode. Diffs for existing shapes, full shapes for new code. |
| Q4 | The Program Design is approved at the gate; code that differs is a Deviation. |
| Q5 | `Size: small` gets a short Program Design (file-tree diff and signatures) and no round. |
| D4, M5 | A technical option shows its code shape and up to 4 metrics named by the Architect (a figure only when known, otherwise low, medium or high with why). |
| Q8a | Decision Page data gets `view: {kind, text}` (kind: diff, tree, calltree, component, pseudocode); the CLI renders it with diff colours. `aidw page render` refuses a question with options that has no `view` or `html`. A yes or no and a name are exempt. The rule covers gate sections and questions asked in the chat (a fenced block). |
| Q8b | `page.ts` gets layouts modelled on the examples: approaches (01), walkthrough (04), plan (16), before-after (17). |

**Plan and delivery**

| Id | Decision |
|---|---|
| I3, Q4 | `tasks.yaml` gets `patterns: [{path, why}]` (path with line range); `aidw brief` inlines up to 3 real snippets of at most 40 lines; `aidw analyze` refuses a pattern whose path or lines no longer exist. |
| I11, M4 | `manual: [...]` on a task lists checks that need a human; the run does not stop for them; `aidw deliver` lists them under "Checks for you" in the handoff. |
| I8, Q5, M8 | The Documentation Role writes `pr-summary.md` at delivery: Why in one sentence, 1 to 3 notes (Deviations, migrations), a change outline made of Views, laid out after example 17. `aidw pr` adds the generated Evidence and refuses a summary that names a file absent from the git diff and from the approved Artifacts. |
| M6, M7 | Terms are in `CONTEXT.md`; every Role, Skill and test is updated to match; every new Authored Skill has at least one Role eval. |

**Later, not in this Change:** I12 `explain` Workflow, I13 fixing after delivery (with `/aidw:amend`), D7 drafted
problem statement and success measure, D8 `refactor` Workflow, R10 refreshing Stack Packs against official docs.

## 3. How to run it: lead, test, review, in parallel

The owner asked for one lead, one test agent and one review agent, in parallel wherever possible.

- **Lead** (the main session) owns this plan. For each task that is ready (all its `after` tasks merged) it creates a
  git worktree under `.worktrees/<task>` on a branch `rpi/<task>` cut from `feat/rpi-upgrades`, and briefs one
  implementer subagent with the task's section. Start every ready task at once, in one message. `.worktrees/` is
  in `.git/info/exclude`. `git worktree add` and `remove` must run outside the sandbox (its `.git/worktrees` is
  read-only).
- **Implementers**: one subagent per task, in its worktree, test-first. They commit on their branch only.
- **Test agent** (fresh context per task): given the task's decisions and the diff. Adds the tests the decisions
  need and are missing, runs `npm run typecheck` and `npm test` on the task branch and again after the merge, and
  reports pass or fail with output. It does not change `src/` or `plugins/`.
- **Review agent** (read-only, fresh context per task): reviews the diff against this plan, the ADRs and
  `CONTEXT.md`; findings are blocking or note. A blocking finding goes back to the implementer.
- **Merge**: the lead merges each finished task branch into `feat/rpi-upgrades` (no squash), in the order the graph
  lists when two finish together, reruns the full suite after each merge, then removes the worktree. A task is
  done when its tests exist and pass, the suite passes after merge, the review has no blocking finding, and the
  docs it touches are updated.
- **End**: `npm run build`, `node bin/aidw roster --write`, full suite, then push `feat/rpi-upgrades` and open one
  pull request (granted by the owner on 2026-11-26). Its base is `feat/factory-run-to-pr` while that branch is not
  merged into `main`; `main` once it is. Never push the `rpi/*` task branches.

Hot files: `plugins/aidw/skills/start/SKILL.md`, `plugins/aidw/workflows/*.yaml`, `src/stages.ts`, `src/analyze.ts`,
`src/page.ts`, `src/tasks.ts`, `src/cli.ts`. Tasks that run together were chosen to touch different parts of them;
when a merge conflicts, the lead resolves it, and the test agent reruns both tasks' tests.

## 4. Task graph

File names are starting points; confirm by reading. Each task names the decisions it carries.

```text
start ─┬─ T1 vendor ───────────┬─ T2 html-pages + commands ─────── T14 delivery ─┐
       ├─ T3 writing rules ────┼─ T12 architect: round + program ┐                 │
       ├─ T4 research discipline ─ T5 docs-research ─────────────┼─ T13 plan ─────┤
       ├─ T6 codebase-research ── T7 existing-system flow        │                 ├─ T15 docs ─ push, PR
       ├─ T8 consult Research                                    │                 │
       ├─ T9 before/after, deferred                              │                 │
       └─ T10 view: field ─────── T11 layouts (also after T1) ───┘─────────────────┘
```

Ready at once: T1, T3, T4, T6, T8, T9, T10 (7 in parallel). Then T2, T5, T7, T11, T12 as their inputs merge, then
T13 and T14, then T15.

**T1 vendor show-me and html-effectiveness.** I7, Q6. Add both upstreams to `scripts/vendor.config.json`; vendor to
`plugins/aidw/library/vendor/humanlayer/show-me/` and `plugins/aidw/library/vendor/anthropics/html-effectiveness/`
with `UPSTREAM.md` and `LICENSE`. Note in `library/vendored-skill-notes.md` what differs under aidw (show-me's
`Bash(open ...)`: aidw shows a link instead).

**T2 html-pages and the two commands.** Q8, Q8b. After T1. Authored Skill `library/skills/html-pages/SKILL.md`
(near 150 lines): kind of page → example number → what to take (layout, components) and what not; shared rules;
points to show-me for the View. User skills `plugins/aidw/skills/show-me/` and `plugins/aidw/skills/html-pages/`
that load the library files. One Role eval.

**T3 writing rules.** I6, I10, D5, D6. `library/author-artifacts.md` (finding headers, plain prose, one shortening
pass, evidence for recommendations, decisions with rejected options); `library/implement-a-task.md` (precedence,
three-line mismatch report on a BLOCKED status); the `## Decisions to honor` format in `skills/start/SKILL.md`
step 9 and wherever `analyze.ts` parses it.

**T4 research discipline.** R2, R6, R7, M12. `roles/research/skills/evidence-scan.md`, `feasibility-spike.md`,
`world-scan.md` and `roles/research/role.md`: source ladder, Quote column, search budget and query patterns. Update
their evals.

**T5 docs-research and the Docs Brief store.** R1, R3, R4, R5, R9, Q-R2, Q-R3. After T4. Skill
`roles/research/skills/docs-research.md`; Research `writes:` the Docs Brief; the reuse rule in the CLI (path by
lib@major.minor-topic, age check) with tests. One Role eval.

**T6 codebase-research.** I2, I4, Q2. Skill `roles/research/skills/codebase-research.md` with the four modes;
Research `reads:` the code. One Role eval (a fixture repo, a neutral question, file:line answers, no proposals).

**T7 the Existing System Report flow.** I1, Q1, Q3, M1, M2, M10. After T6. `skills/start/SKILL.md` step 1b: the
questions file, parallel Research Agents per group, the merging Agent; `existing-system.md` as an Artifact of the
Workflows' stages (`workflows/*.yaml`, `src/stages.ts`, `src/artifacts.ts`); `## Existing system` becomes its
summary; greenfield, `bugfix` and small rules.

**T8 implementers consult Research.** Q-R1. `src/consult.ts` (pair check and the once-per-task budget), the
implementing Roles' `consults:`, `skills/run/SKILL.md`; tests for the budget.

**T9 Before / After and Deferred to architecture.** D1, I9. Product Manager `role.md` and `discovery-frame` skill;
the `analysis.md` template; `aidw analyze` requires both sections (Before from the report when it exists); the gate
page puts Before / After first; the Software Architect answers each deferred line.

**T10 the `view:` field.** Q8a, M9. `src/page.ts`: parse and render `view` (kinds, diff colours), refuse a question
with options and neither `view` nor `html`; exempt yes or no and names; `library/decision-pages.md` (rule, chat
questions as a fenced View). Tests.

**T11 layouts and option metrics.** D4, Q8b, M5. After T10 and T1. `src/page.ts` layouts approaches, walkthrough,
plan, before-after modelled on examples 01, 04, 16, 17 (static, no network, as the page rules say); `metrics` on an
option (at most 4). Tests and the page docs.

**T12 the architect's round and the Program Design.** D2, D3, I5, Q2 to Q7, Q6, M9. After T3. Software Architect
`role.md`: open Design Questions (criteria, at most 5) and settled ones with reasons; a second run that writes
`program-design.md`. New stages `system-design-round` and `program-design` in `workflows/*.yaml` and
`src/stages.ts`; `skills/start/SKILL.md` step 6; small changes get the short version and no round; the gate shows the
Program Design; `src/deviation.ts` treats a difference from it as a Deviation; `aidw analyze` checks the required
parts. Merge after T7 if both are ready (same files).

**T13 the plan carries patterns, docs and manual checks.** I3, Q4, R8, M13, I11, M4. After T5 and T12. Technical
Planner `role.md` and `task-interfaces` skill (cut tasks from the Program Design); `src/tasks.ts` schema; the brief
(`src/` brief code) inlines snippets and Docs Briefs; `aidw analyze` checks pattern paths and lines and that each
`docs:` has a fresh Docs Brief; the gate's plan section lists them.

**T14 delivery.** I8, Q5, M8, M4. After T2. Documentation `role.md` writes `pr-summary.md` after example 17;
`src/pr.ts` merges it with the Evidence and refuses unknown paths; `src/deliver.ts` adds "Checks for you" from
`manual:`; `skills/deliver/SKILL.md`.

**T15 documentation and the end.** M6, M7. After everything. `docs/user-guide.md` (Vietnamese),
`docs/factory-architecture.md`, `README.md`; check every new term against `CONTEXT.md`; build, roster, suite, push,
pull request.

## 5. Open points for the implementing session

Ask the owner on an HTML page (the owner's standing preference) before building around any of these:

- The exact text of the 2 to 7 neutral questions is the orchestrator's; if a Role eval shows it leaking the request,
  decide whether a CLI check is needed.
- Whether the merging Research Agent may read code beyond the contradictions (M10 says no).
- How `aidw analyze` tells a "library new to the project" for `docs:` (lockfile diff before and after the plan is
  the obvious answer; confirm when T13 starts).

## 6. Prompt for the new session

> Read `docs/plans/rpi-upgrades.md` and the files it lists under "Read first". You are the lead. Build the whole
> plan as one Change on `feat/rpi-upgrades`, as section 3 describes: start every ready task of the graph in parallel,
> one implementer subagent per task in its own git worktree under `.worktrees/`, one test agent and one review agent
> per task, merge each finished task into `feat/rpi-upgrades` with the full suite after every merge. When everything
> is merged and green, push `feat/rpi-upgrades` and open one pull request (base `feat/factory-run-to-pr` unless it is
> already in `main`). When a task meets an open point from section 5, ask me with an HTML page before building it.
