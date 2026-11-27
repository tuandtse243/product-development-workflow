# aidw Software Factory: architecture

Status: **design accepted** (2026-11-14); of the proposals in section 12, items 2 and 3 are applied and the
rest still wait for an explicit yes. Migration step 1 is in progress: the four agents that existed are now
Roles (`fullstack`, `code-reviewer`, `security`, `ui-ux-designer`) and their agent files are generated.

This document collects the decisions of the three interview rounds (Q1 to Q40) into one design. Vocabulary is
defined in [`CONTEXT.md`](../CONTEXT.md). The two decisions that are hard to reverse have their own records:
[ADR-0003](adr/0003-cli-owns-flow-declared-decision-points.md) (orchestration) and
[ADR-0004](adr/0004-role-folders-are-the-source.md) (Role folders). Background reading, not a spec:
`AI-FULLSTACK-SOFTWARE-FACTORY-REFERENCE.md`.

Section 12 lists what this document proposes beyond what the interview decided. Read that section critically.

## 1. What changes and what stays

aidw becomes a small software company that installs into any project. It keeps its name and its deterministic
core: the CLI, the Change state machine, the gate hook, per-task evidence, independent review, the runner,
quality layers, converge and delivery.

What is new is the organization on top of that core:

- a **Roster** of 21 Roles, each a folder with its own profile, rules, skills, references, scripts and evals;
- **Workflows** as data, one per kind of request, that say which Role does what and where the user approves;
- **Decision Points**, the only places where an LLM chooses a branch;
- knowledge that loads only when a piece of work needs it.

The first version runs on Claude Code only. Role folders are written platform-neutral so adapters for other
platforms and cheaper models can be generated later.

## 2. The Roster

21 Roles in four Departments: the 20 the user listed plus `fullstack`. 10 are active (the first nine, then `database`); a Planned Role's work is carried by the Role
in the last column until it is activated. The Orchestrator (main session plus CLI) is not a Role.

| Role id | Department | First version | Carried by |
|---|---|---|---|
| `product-manager` | Product & Analysis | active | |
| `business-analyst` | Product & Analysis | planned | `product-manager` |
| `research` | Product & Analysis | planned | `product-manager` |
| `ux-research` | Product & Analysis | planned | `product-manager` |
| `ui-ux-designer` | Architecture & Planning | active | |
| `software-architect` | Architecture & Planning | active | |
| `database-architect` | Architecture & Planning | planned | `software-architect` |
| `api-designer` | Architecture & Planning | planned | `software-architect` |
| `technical-planner` | Architecture & Planning | active | |
| `frontend` | Implementation | active | |
| `backend` | Implementation | active | |
| `fullstack` | Implementation | active | |
| `database` | Implementation | active | |
| `integration` | Implementation | active | |
| `devops` | Implementation | active | |
| `qa` | Quality & Delivery | planned | test plan: skipped (spec scenarios stand in); coverage: CLI `converge` |
| `code-reviewer` | Quality & Delivery | active | |
| `security` | Quality & Delivery | active | |
| `performance` | Quality & Delivery | planned | CLI quality layer |
| `documentation` | Quality & Delivery | planned | `deliver` skill |
| `release` | Quality & Delivery | planned | CLI `deploy` and `pr` |

`fullstack` is the one Role added to the user's original 20. It is today's `implementer` with a profile. Nothing is
copied into it: `follows_rules: [backend]` binds its server side to backend's `rules.md`, its `skills:` index lists the
two library skills backend lists, and its body points at backend's six own skills by path (an index entry names only a
Role's own skill or a `library/` one) and at the frontend Role's section for a screen.

Boundaries decided in the interview:

- **`database-architect` and `database`** stay two Roles, separated by Artifact: the architect writes the data
  model before the Approval Gate, `database` writes migrations, seeds and indexes after it.
- **`qa`**, once active, writes the test plan and test cases from spec scenarios before implementation, and
  closes coverage gaps after it. The CLI remains the party that runs tests and decides pass or fail.
- **Reviewers** (`code-reviewer`, `security`, the review side of `ui-ux-designer`) read and give a verdict.
  They never change code. `code-reviewer` reviews two things: each finished task, and, before the Approval Gate,
  the architecture and plan of the Change (its `plan-review` skill; section 7).

## 3. A Role

A Role is a folder. It is the single source for everything about that position.

```
roles/<id>/
  role.md        profile: machine-readable header + what the Agent reads first
  rules.md       rules of this position (always loaded with role.md)
  skills/        how to do one kind of work (loaded on demand)
  references/    lookup material (loaded on demand)
  scripts/       tools of this position
  evals/         cases that test this Role alone
```

`role.md` header:

```yaml
---
id: api-designer
description: Designs the API contract of a change. ...
mode: worker               # interactive | worker; a workflow stage may override
tier: standard             # deep | standard | fast
access: write              # write | artifacts | read-only: what the gate lets this Role's Agent do
tools: [Read, Write, Edit, Glob, Grep]
includes: [library/implement-a-task.md]   # shared procedure, appended to the generated agent
consults: [software-architect]           # Roles its Agent may ask through the Orchestrator (a Consultation, ADR-0013)
skills:                    # on-demand: roles/<id>/skills/<name>.md, read only when the condition holds
  - rest-contract:   when designing a new endpoint
  - breaking-change: when changing an existing contract
  - library/external-api: when calling an outside service   # shared: library/skills/<name>/SKILL.md
follows_rules: [backend]   # other Roles' rules.md that also bind this Role's work (listed in its review brief)
---
## Responsibility
## Procedure
## Done when
## Ask before you guess   (a Consultation; implementing Roles, library/implement-a-task.md)
## Stop and report when
```

`access` tells the gate what the Role's Agent may write: `write` edits project files (implementing Roles, never
`.aidw/`), `artifacts` drafts under `.aidw/` only, never project files (the gate's normal rules also apply inside `.aidw/`:
the approved package is frozen), `read-only` writes only a verdict. `includes` appends shared text such as the
procedure all implementing Roles follow, so it exists once. `reads` and `writes` list Artifact names from
`artifacts.yaml`; the profile's text still names the paths for the Agent, and `aidw roster` checks the names.
`consults` lists the Roles an Agent of this Role may ask a question while it works (section 7, Consultation);
`aidw roster` refuses an id that is not in the Roster, a Role that is not active, and the Role itself, and the
generated agent ends with a "Consultation" note naming them. The first pairs: `ux-research`, `product-manager` and
`software-architect` ask `research`; `technical-planner` asks `software-architect`; `backend`, `frontend` and
`fullstack` ask `api-designer`, `database-architect` and `software-architect`.

`rules.md` is a table (plan R2): one row per rule that can be answered pass or fail.

```markdown
| id | rule | applies when | checked by |
|---|---|---|---|
| B7 | A write that changes more than one table runs in one transaction. | the task writes more than one row or table | reviewer |
| B13 | Every environment variable the diff reads is listed in `.env.example`. | the diff reads an environment variable | script, reviewer |
```

An id is capital letters then a number with no leading zero (`B1`, never `B01`), unique in the Role; `checked by`
is one or more of `reviewer`, `script` (the Role's own measuring tool in `scripts/`) and `CLI` (a deterministic
check), comma-separated. Text may stand before and after the table; a file holds one rules table. `aidw roster`
refuses a duplicate id, an empty field, a row with the wrong number of cells, an unknown checker and a second
table. A `rules.md` with no `| id |` header row is the older prose format and is left as it is; the Roles move to
the table one at a time (backend first). The review brief of a task points at the `rules.md` of the Role that
built it, and at those of the Roles its `follows_rules` lists (`aidw roster` checks each is a Role with a
`rules.md`). A rule checked only by the CLI is already proven by the checkpoint; the reviewer judges the others,
counts a rule whose right action is to ask as kept when the implementer asked, and cites the rule id in each
finding that breaks a rule (`1. B7: src/orders.ts: ...`).

A skill in the index is the Role's own (`<name>`, `roles/<id>/skills/<name>.md`) or a shared one
(`library/<name>`, `library/skills/<name>/SKILL.md`) that several Roles list; `aidw roster` checks the file exists.

Department, status and `carried_by` live only in `roster.yaml`, so a Planned Role can be declared before it has
a folder and activating one is a one-line change. `aidw roster` checks the Roster, every profile and that the
generated agent files are up to date.

- **Run mode.** `interactive`: the main session loads the Role to talk with the user. `worker`: the Role runs
  as a subagent in a fresh context. An interactive Role only interviews and records questions and answers on
  disk; a worker Agent of the same Role drafts the Artifacts from that record and replies with one line.
- **Tier.** A Role names the class of model it needs, never a model. Configuration maps tiers to models. In
  the first version every tier may map to the same Claude model; the Role's own evals show whether a cheaper
  model is good enough before the mapping changes.
- **Generated agents.** The build reads `roles/` and writes `agents/<id>.md` for every active Role that has
  a profile (name, description, tools, model from the tier map, body from `role.md` followed by `rules.md`).
  An interactive Role gets one too: it is the worker Agent that drafts or reviews for that Role. Generated files carry a "do not
  edit" header and a test fails when they are out of date.
- **Role scripts.** `roles/<id>/scripts/` holds the Role's measuring tools (plan R1): dependency-free Node ESM
  (`.mjs`, built-ins only, Node 20 or later), called by path through `aidw plugin-path roles/<id>/scripts/<name>.mjs`.
  Each documents its usage at the top of the file and prints it with `--help`, writes JSON by default (`--text` for
  a short table) and is advisory: a finding never makes it exit non-zero, only a usage or read error does (exit 2).
  Pass/fail checks stay in the CLI. A file starting with `_` is a helper the scripts share, not a tool. The tests
  live under `tests/` (fixture trees in temp dirs, the script run with `node <path>`). The backend Role has five:
  `route-inventory` (routes, the tests that call each, the B2 access cases those tests assert), `env-names` (names
  read against `.env.example`, never a value), `error-shape-probe` (error bodies against the declared error shape,
  statically and on responses the tests captured), `query-count` (statements for 1 row and N rows; also a module a
  test imports) and `leak-and-timeout-scan` (outbound calls with no timeout, log calls carrying secrets or whole
  objects). `route-inventory`, `env-names`, `error-shape-probe` (its static probe) and `leak-and-timeout-scan` take
  `--base <ref>` to look only at what a diff adds; `query-count` reads logs and takes no `--base`. Every JSON output
  starts with `tool` and `schemaVersion: 1`; a directory scan lists under `skipped` what it did not read (`public/`
  and `static/` output, minified or bundled files, files over 512 KB, unreadable files). `query-count --run`
  executes a command, so a read-only reviewer does not use it.

## 4. Knowledge loading

The requirement is that nothing loads until a piece of work needs it.

| Always loaded for an Agent | Loaded on demand |
|---|---|
| company rules, `role.md`, `rules.md`, the Project Overlay rules for that Role, the task or stage brief | skills, references, Stack Packs |

On-demand knowledge reaches an Agent in two ways, both allowed:

1. the Technical Planner pins skills on a task (today's `skills:` field in `tasks.yaml`);
2. the Agent pulls more from the skill index of **its own** Role when the brief matches an entry's condition.

Shared skills (test-first, debugging, git workflow, the vendored Pocock and Addy skills) live once in
`library/`. A Role's index references them; they are never copied into a Role.

**Stack Packs** have two layers ([ADR-0001](adr/0001-stack-packs.md), amended). A language pack answers
tooling questions (install, format, lint, test). A framework pack answers how to build with that framework
(structure, conventions, common mistakes). Roles stay stack-neutral: `frontend` on a Next.js project loads
`node` plus `nextjs`; `backend` on a NestJS project loads `node` plus `nestjs`. Next.js and NestJS are the
first framework packs. Express, Fastify and Hono are HTTP libraries that `aidw detect` reports as the `server`, not
the `framework`: their packs say `detected_as: server` and load only when no framework pack matches, so a NestJS
project that also lists `express` gets `nestjs` alone. Selection has limits: a Next.js app with a separate Express
server in the same `package.json` gets `nextjs` only, and `aidw detect` keeps only the first server dependency it finds.

**What a backend task receives (audit, 2026-11-24, plan T17).** Read from a real implement brief (`aidw brief`) for a
task with `role: backend`, Touches `src/bookings/**`, an API contract, a data model and Express in `package.json`, and
from the generated `agents/backend.md`:

| Piece | Where it reaches the Agent |
|---|---|
| Responsibility, procedure, Done when, ask rule, rules for every implementing Role | agent file (`role.md` body + `library/implement-a-task.md`) |
| The Role's own `rules.md` | agent file (`## Rules`, generated); the review brief points at the same file |
| Rules of a Role it follows (`follows_rules`, fullstack follows backend) | review brief; **was missing** from the implement brief |
| The Role's skill index, incl. `library/external-api`, `library/resilient-integration` | agent file, one `aidw plugin-path` command each; the Agent decides (R3) |
| `references/`, `lessons.md` | named in `role.md`, read on demand |
| Scenarios, requirement text, Decisions to honor, Touches, Verify, envelope, finished dependencies | brief |
| Constitution, domain model, architecture, data model, API contract and OpenAPI, test plan, ADRs | brief, "Read first", each only when the file exists |
| Consultation rule (who may be asked: the authors of this task's contracts that the Role `consults`) | brief |
| Skills picked by signal (`incremental-implementation`, `test-driven-development`, `verification-before-completion`, `api-and-interface-design`, `aidw/api-design-rules`; `aidw/schema-evolution` when Touches hit the data layer) | brief |
| Framework pack of the project (`stacks/express.md`...) | brief, implement only; **was missing** from the review brief |
| Language pack (`stacks/node.md`, `stacks/python.md`) | **was missing**: the agent file says `stacks/<language>.md` and left the Agent to guess the language |

Fixed in `src/run.ts`: both briefs point at the language pack `aidw detect` reports and at the framework pack of the
building Role (the reviewer judges by the conventions the implementer followed), and the implement brief lists the
`rules.md` of the Roles the building Role follows (its own stays in the agent file only, as T12 decided). Not
changed, by design: the library skills are not picked by signal (the Agent loads them from its index, and level 2
cases check that from the tool log, C4); `references/` and `lessons.md` are not pointed at from the brief.

## 5. Rules

Three layers, each adding to the one before:

1. **Company**: `company/rules.md`, for every Role (permissions, tiers of risky actions, how to report).
2. **Role**: `roles/<id>/rules.md`.
3. **Project Overlay**: `.aidw/roles/<id>/rules.md` and `.aidw/roles/<id>/references/` in the user's
   project, plus the existing `.aidw/constitution.md` for project-wide conventions. An overlay adds; it
   cannot replace a Role's profile.

Departments group Roles for the Roster and for reports. They carry no rules.

## 6. Artifacts

Roles hand work to each other through Artifacts on disk, never through summaries in a prompt. One registry
names every Artifact:

```yaml
# artifacts.yaml
api-contract:
  path: architecture/api-contract.md     # inside .aidw/
  owner: api-designer                    # exactly one Role writes it
  validate: aidw validate
```

Two Artifacts may share one file or folder (the sections of `analysis.md`, the ADRs of two Roles); each then
carries a `part` saying which part it is, so that ownership stays one Role per Artifact. `aidw roster` checks
today that every Artifact has one owner who is in the Roster, that `reads` / `writes` name only registered
Artifacts and that a Role writes only what it owns; `aidw roster` also checks the Workflow files (section 8).

The CLI uses the registry and the Roles' `reads` / `writes` to check three things: every Artifact has exactly
one owner, no Workflow stage reads an Artifact that no earlier stage writes, and an Artifact exists and
validates before the Change leaves the stage that produces it. When a Planned Role is carried, the carrier
writes the Artifact and the registry still names the true owner.

## 7. Orchestration

The CLI computes every transition from the Workflow definition ([ADR-0003](adr/0003-cli-owns-flow-declared-decision-points.md)).
The LLM Orchestrator classifies the request, talks with the user and reports. It never picks a step that the
Workflow does not contain.

When the user has to choose, the Orchestrator does not print the options into the chat. It writes them as data and
the CLI renders a **Decision Page** ([ADR-0007](adr/0007-decision-pages-are-views.md)): interview rounds, the design
direction, an escalated task's decision, the audit pick list and the Approval Gate. The user's choices come back as
pasted text that the CLI checks before anything is recorded; the page is a view under `.aidw/run/pages/` and never
an Artifact. How a Role writes one: `plugins/aidw/library/decision-pages.md`.

Six kinds of decision, and who makes each:

| Decision | Made by | Control |
|---|---|---|
| Which Workflow fits the request | Orchestrator proposes | user confirms; recorded by the CLI |
| Which stage is next | CLI, from the Workflow | none needed |
| Whether a stage applies (UI? data change?) | the declared Role, from a fixed set of answers | shown at the next Approval Gate |
| Which Role owns a task, and the shape of each Slice | `technical-planner` | approved at the plan gate, then frozen |
| Whether work is done | CLI: tests, evidence, an independent reviewer's verdict | an Agent's own report is never evidence |
| Where to go after repeated failure | `software-architect` with the triage skill | the CLI routes the cause; upstream causes go to the author Role (ADR-0014), never to the user |

A Decision Point in a Workflow:

```yaml
- id: design-needed
  decide: ui-ux-designer
  options: [full-design, reuse-existing, no-ui]
  approval: at-next-gate
```

The deciding Role writes its answer and reason as an Artifact. The CLI rejects an answer outside `options`.

**What runs at the same time (D13).** The CLI, not the Orchestrator, decides which pieces of work may run in
parallel, at every level, from what each one reads and writes (`src/stages.ts`):

- *Files, not names.* Each Artifact is compared by its file in `artifacts.yaml`, so two sections of `analysis.md`
  conflict. A family of files (a path with a placeholder other than `<id>`, such as a spec per capability) and the parts
  of `decisions.yaml` (written only by `aidw decide`, one call at a time) are compared by name. All ADR writers share
  one key, because they take the next `decisions/NNNN` number.
- *Analysis stages.* `aidw stages <id>` lists the stages before the Approval Gate as done, ready, or `now`. A stage is
  ready when no earlier unfinished stage writes what it reads, reads what it writes, or writes the same Artifact, and
  no gate stands between them (a gate runs alone, and nothing after it starts first). A stage is done when the
  Orchestrator reports it (`aidw stages --done <stage>`, also for a stage a Decision Point skips), when the Change
  state is past it, when a later gate is passed, or, only for a Change started before this existed (no `stages.yaml`, which
`aidw change new` now writes) and while `analyzing`, when every Artifact it writes is on disk and filled in. Only the Orchestrator may report one: `aidw stages --done` is a state
command an Agent is denied. Recorded in `changes/<id>/stages.yaml`, outside the approved package.
- *Reviewers.* `aidw verify` no longer stops at the first review layer: it runs every layer, and each review layer
  whose commands pass waits for its reviewer. The waiting reviewers are offered together.
- *Tasks.* Waves, as before (section 9 and `src/parallel.ts`): disjoint `touches`, `depends_on` done. A merge
  conflict between two tasks of a Wave goes to the `integration` Role (D11, below).

From what is ready, one group is offered in one `NEXT:`: greedily, in Workflow or layer order, leaving out a piece
that conflicts with one already in, a second piece of **browser-driving** work (the project has one test browser: a
`ui` reviewer, a stage marked `browser: true` such as `design`, which screenshots its mocks), and anything past
`parallel.max` of `quality.yaml` (3 until that file exists). When reviewers and analysis stages are both ready the
reviewers' group comes first. The Orchestrator spawns one subagent per piece, all in one message, and reports each
back on its own (`aidw stages --done <stage>`, `aidw layer-review <layer>`); a single-piece group is the old
one-step flow. A `fix` verdict of one reviewer sends the Change back to `executing`; the other verdicts of the same
group are still recorded while their layer awaits review on unchanged code.

**Review before the gate (D4, [ADR-0011](adr/0011-approval-gate-stays-after-the-plan.md)).** The last analysis stage of
every building Workflow is `plan-review`, after `quality-profile` and before `approval`. Once `aidw analyze` is clean,
`aidw plan-review <id> --brief` writes the brief (it refuses while the CLI's own checks fail) and the Orchestrator spawns
one read-only `code-reviewer` Agent, a Role that wrote none of the package. It grades the architecture, the plan and the
test plan against a fixed list: (1) every approved scenario has a task that really delivers it, (2) no task outside the
approved scope, (3) the constitution is followed, (4) no needless complexity. It writes `.aidw/run/review-plan-<id>.md`
(Artifact `plan-review`): `VERDICT: pass | fix` and numbered findings `[item N] <task id | scenario id | area>: problem ->
fix`. `aidw plan-review <id>` checks the shape (a known item, a task, requirement, scenario or area of this Change) and
records the verdict as a round in `changes/<id>/plan-review.yaml`, outside the approved package, with a digest of the file
and a digest of the reviewed plan: every input the brief points the reviewer at except `analysis.md` (tasks, the Change's
specs or the main specs when it has none, the requirements, architecture and project decisions, constitution,
`decisions.yaml`, data model and API contract notes, `openapi.yaml`, test plan, `quality.yaml`). The digest is taken when
the brief is written; a verdict recorded after the plan changed is refused ("brief again"). The CLI records only the round
the last brief was written for, so every round needs its own brief and a round may repeat the previous verdict word for
word. A verdict in the wrong shape is refused and not counted.
Each finding is routed to the owner of the Artifact it names when a stage of the Workflow has that Role write it, otherwise
to the lead.

| Round | Verdict | What follows |
|---|---|---|
| 1 or 2 | `pass` | the stage is done |
| 1 or 2 | `fix` | the authoring Roles fix the findings (the CLI names one per finding), `aidw analyze` again, then a new brief listing the open findings and a new review |
| 3 | `fix` | the 2 fix rounds are used up: the stage is done and the findings are carried |

`aidw transition <id> awaiting_approval` is refused until the review is recorded: no verdict, a fix round still open, a
verdict file changed after it was recorded, or a record that cannot be read. `.aidw/run/` is not committed, so a missing
verdict file is no reason to refuse once a final round is recorded. When the user sends the package back and the reviewed
plan changes, the gate is refused ("the plan changed since the review") and the next brief starts a new cycle of rounds.
The cap of 2 fix rounds holds per cycle, and a cycle restarts only when the reviewed plan changes, never on request; an
unchanged plan keeps its review. `aidw approve --auto` (bugfix) refuses a Change whose review carried
findings: the user decides at the gate page. Only the code-reviewer may write the verdict file and no Agent may write
`plan-review.yaml` (the gate hook denies them, comparing the names without case, as macOS and Windows file systems do), so
an authoring Role cannot forge the review of its own work. The lead (the Orchestrator's main session) is trusted: the hook
does not stop it from writing these files, as it does not stop it from writing any other state under `.aidw/`. The gate Decision Page then opens with the carried findings
("Open findings of the independent review", added by the CLI before the authored sections), so the user approves with
them or asks for a change. The stage is never reported with `aidw stages --done`: it counts as done exactly while the
recorded review counts.

**A Wave's merge conflict (D11).** When a task's merge into the Change Branch conflicts, its work is kept: the task
goes to status `conflict` and the CLI drives four steps (`src/conflict.ts`), each printing the next, so the main
session and the runner follow the same path:

| Step | Command | What the CLI does |
|---|---|---|
| detect | `aidw verdict <task>` (pass) | aborts the merge, names the task(s) already merged that changed the files (their `Task:` footers), records the conflict in `changes/<id>/conflicts.yaml` |
| brief | `aidw brief <task> --for conflict` | merges the Change Branch into the task's worktree, stops at the markers, briefs `integration` with both tasks, the files and both branches |
| resolve | `aidw resolve <task>` | commits the merge in the worktree; against both sides of it (the task's commit and the Change Branch) refuses conflict markers in any changed file, junk, and what a checkpoint's guards refuse (tamper, check configuration, secrets, packages); runs both tasks' checks again (verify, a test per scenario); evidence `evidence/merge-<task>.json`. A check the machine refused leaves the conflict open |
| review | `aidw brief <task> --for merge-review`, `aidw verdict <task>` | a `code-reviewer` judges only the resolution; pass merges the task as usual |

When the merge is started the files and the tasks on the other side are found again (the Change Branch may have moved),
and a binary file in the conflict falls back at once: no marker can show both sides. Any failure (markers left, a
guard or a check fails, a `fix` verdict, a second conflict) falls back to the old behaviour: the
branch is dropped and the task reruns sequentially on the latest code. `conflicts.yaml` keeps every conflict with its
outcome (`open`, `resolved` once the final merge is committed, `dropped`) and reason; the `technical-planner` reads it when it plans, so the files go
into the `touches` of both tasks (or the tasks are chained) and they stop running side by side.

**Consultation (D7, [ADR-0013](adr/0013-agents-consult-other-roles-through-the-orchestrator.md)).** An Agent that lacks
information asks; it never guesses, and the user is not the first stop. It never spawns the other Role itself: it writes
a request and ends its turn, and the Orchestrator runs the rest through the CLI (`src/consult.ts`). Every step lives in
files, so the lead in its session and a short runner session (`claude -p /aidw:resume`) follow the same path.

| Step | Who | What happens |
|---|---|---|
| ask | the asking Agent | writes `.aidw/changes/<id>/consult/<name>.request.md` (the path is in its brief: `<task>.request.md` in the build, `<stage>-<role>.request.md` before the gate) with a front matter `from`, `task` or `stage`, `to` and two sections, `## Question` and `## Progress` (done so far, next step, files touched); replies `CONSULT <path>` |
| check and record | `aidw consult <request>` | refuses a pair the asker's `consults` does not declare, a consulted Agent asking in turn (depth 1: a `consultation:` field, or the asker is the Role an open Consultation waits for), a request from an Agent run that still waits for an open Consultation (its asker ended its turn with that question),
a request path that is a recorded `C<NN>` copy or a request already recorded (a crash between the record and removing
the original), a `brief:` outside `.aidw/run/briefs/<id>/`, a third question of one Agent run (`task:<T>#<run>`, where
`runs` in tasks.yaml rises on every new attempt and is never reset, so a retry the user grants is a new run; or
`stage:<stage>:<role>`, one budget per stage and Role, not reset by plan-review fix rounds) and, in the build, a Role that wrote no contract the task reads (the owners in `artifacts.yaml` of the Artifacts the task's brief reads that exist in this Change, from one list,
`src/briefreads.ts`, that also builds the brief's pointers: `api-designer` for the API contract, `database-architect` for the data model, `software-architect` for the architecture). Records `C<NN>` in `changes/<id>/consultations.yaml` (outside the approved package), keeps the request as `consult/C<NN>.request.md`, writes the consulted Role's brief and prints its `SPAWN` |
| answer | the consulted Agent | writes `consult/C<NN>.answer.md`, first line `STATUS: answered`, `cannot-answer` or `changes-approved` (`next` then says `record`, not spawn again) |
| route | `aidw consult answer C<NN>` | reads the status and always writes a resume brief (`.aidw/run/briefs/<id>/C<NN>.resume.md`): the original brief, the progress note, the question and the answer path |
| resume | `aidw consult resume C<NN>` | marks it resumed and prints both ways on: SendMessage to the asker if it still runs in this session (an optimisation), otherwise a fresh Agent of the same Role with the resume brief (the guaranteed path) |

`aidw next` and `aidw stages` put an open Consultation (get the answer) or an answered one (resume the asker) before
anything else, so a fresh session finds it. The other tasks of a Wave carry on meanwhile: `next` computes the rest of the
Change without the tasks that wait for an answer and returns it as `meanwhile`, done in the same message. Only work that
cannot touch the asker's half-done work runs beside it: nothing at all when the asker runs on the main checkout (a
sequential Change); with askers in their own worktrees, reviews, conflicts, integration and tasks already running in
their worktrees, and new tasks only as a wave in which every running task holds its slot of `parallel.max`, its touches
and its browser (`planWaveBeside`). `aidw roster` refuses `consults:` naming a read-only Role, which could never write
its answer; the hook knows an Agent's Role, not its task, so an implementer's request path is tied to a running task of
its Change, and `aidw consult` checks the Role runs it. The depth rule
is checked by Role, which holds with today's stage order (no Role answers while an Agent of it runs its own work). A later
brief of the task lists every answered Consultation of it, so the answer survives a resumed Agent that was lost too.
After the Approval Gate the run never asks the user ([ADR-0014](adr/0014-after-the-approval-gate-the-run-does-not-ask-the-user.md)):
an answer that cannot be given, or would change something approved, is recorded as `needs-deviation` with
`route: deviation` and `deviation: pending`; `next` then asks for a Deviation by the author Role (below), and closing it
sets `deviation: recorded`, adds what changed to the resume brief and lets the asker resume on the changed package. Before the gate a question nobody could answer becomes an open question
in the asker's Artifact and is listed, with its words, on the gate's Decision Page beside the open findings; a stage is
not reported done, and the package is not approved, while a Consultation of it is in flight. The request, the answer and the resume brief are the only new
files: the gate hook lets an implementing Agent write only `<task>.request.md` of a task running in that Change, only the Role
consulted in an open Consultation write its `C<NN>.answer.md`, no Agent any other `C<NN>` file (compared without case),
and no Agent `consultations.yaml`; an authoring Role writes its own request under its usual `.aidw/` rule.
`aidw consult` is a state command, so only the Orchestrator runs it.

**Deviation** ([ADR-0014](adr/0014-after-the-approval-gate-the-run-does-not-ask-the-user.md), `src/deviation.ts`).
After the gate the approved package still moves, but only by a recorded decision of the Role that wrote what moves.
The Orchestrator opens one (`aidw deviation open --role R[,R2] --files a,b --reason "..." [--consultation C01] [--task T]`):
the Change must be building (executing, verifying, converging) with a valid approval, no other Deviation open, every
file part of the approved package (the change's package files, its delta specs, `tasks.yaml`, the constitution, the
project's design, domain, architecture and requirements folders, the main specs its deltas apply to; each named file
is resolved to its spelling on disk, so a case variant is one file) and each file written by a named Role in
`artifacts.yaml`. Several Roles only when one change spans their files (a scenario renamed in the delta spec and in
`tasks.yaml`). Opening copies the files into `changes/<id>/deviations/D<NN>/` with the per-file digests of the approved
package and its scenario and requirement index, and writes the author's brief with the three rules (keep the purpose,
smallest change, no new scope). The first two are the author's and the reviewers' judgment; the CLI checks what it can
of the third. While it is open the gate hook lets each named file be edited by its author Role only, with the Write
tool at its exact path (every other Agent and the Orchestrator are denied, and so is a Bash write naming the file:
redirects, in-place edits, copies, inline code, `git checkout --`, `git restore`, a formatter's `--write` or `--fix`;
best effort like H1, since a path relative to another `cd`, a glob or a variable is not caught), the
approval hash reads those files as they were when it opened, so an edit to any other approved file is still drift,
and while `quality.yaml` is open the grants and the tier 2 permissions are read from its approved copy. `next` returns
the Deviation first, with `meanwhile` for work already in flight (none when `tasks.yaml` is open: the CLI would record
progress in the file being edited). `aidw deviation close [--remove-reason R] [--scope-reason R] [--summary S]` checks
what the CLI can check:

| Check | Refused when |
|---|---|
| drift | another approved file changed (named, from the per-file digests) |
| half written | `openapi.yaml` does not parse, `data-model.dbml` has an unclosed block, a new or changed scenario lacks its WHEN or THEN |
| grants | `grants`, `permissions` or a layer's `run` or `setup` commands in quality.yaml changed: they are the user's |
| package | `aidw validate` + `aidw analyze` report an error on the changed package |
| scenarios | an approved scenario is gone with no reason (`--remove-reason "<why>"` for all, or `"<scenario>=<why>; ..."`) |
| scope | a new requirement without `--scope-reason`; a new scenario under no approved requirement |
| tasks | a new planned task lists no approved scenario under `scenarios:` |
| in flight | a task that must run again (other than the one the Deviation names) is running, in review or in conflict: wait for it to settle |
| contracts | never refused: `openapi.yaml` and `data-model.dbml` are classified additive, breaking or, when the text changed with no difference the CLI can classify, unclassified (`src/contractdiff.ts`: operations, parameters, bodies, responses, schema properties, required, types, enums; tables, columns, a new NOT NULL column without a default, enums); `api-contract.md` and `data-model.md` are `prose` (rerun by Role, even beside an `openapi.yaml` or `data-model.dbml`: the notes carry rules the machine-readable contract does not) |

Then it records the closed Deviation and rehashes the package with the approval's own version (`approval.push` is
read from the record and kept, so the push grant still holds), appending `{deviation, previous, hash, reason, roles,
files, at}` to `approval.history`; only after that does it reset tasks, so a Change in verifying or converging returns
to executing on a valid approval, and it marks the record `finished`. A close interrupted between these steps is
finished by the next CLI command (`finishDeviations`, run before every command reads the Change): when the approval
still names the starting hash and the package hashes to the recorded new one, it writes the new hash; then it makes the
recorded resets and the Consultation update, which are idempotent. The tasks to run again: tasks whose planned fields changed, whose scenarios were
removed or changed, whose requirements changed; every task that reads a changed constitution, domain, architecture or
requirements file, or a changed "Decisions to honor"; for a breaking, prose or unclassified contract the Roles that build
against it (API: backend, frontend, fullstack, integration; data model: database, backend, fullstack, integration; an
additive change reruns none and records them as `readers`); the UI tasks for a design change; the task the Deviation
names; and every task that depends on one of them. The done ones go back to pending with their quality results
dropped; the others are not running (close waits for those), so they build on the changed package when they next
start. `aidw deviation abandon` puts the files back (for `tasks.yaml` only the planned fields, keeping the progress the
CLI recorded meanwhile) and marks a Consultation that routed here `deviation: abandoned`; `aidw consult resume` waits
while its Deviation is open. `aidw status` shows an open Deviation; the runner counts opening and closing one (and a
rehash) as progress. The record is `changes/<id>/deviations.yaml`, beside the package and not in it (writing it is never
drift; no Agent may write it or `deviations/`): per Deviation its roles, files and authors, reason, Consultation and
task, the previous and new hash, the files that changed, the author's summary, the scenarios removed (each with its
reason), added and changed, the requirements added, removed and changed (with the scope reason), the contract
classifications with their readers, the tasks added, removed (and which of those were done) and changed, the rerun list
and the tasks reset. It is the source of the pull request's "differs from the approved package" section. The seam for
the upstream fix loop: `openDeviationFor(p, id, {role, files, reason, task, pluginRoot})` and `closeDeviation(p, id,
{pluginRoot})` are the same path for a Triage cause in the plan, a spec or the architecture.

**Package version.** The approval record names the package version it was hashed with (`approval.package`). Version 2
added the contracts (`openapi.yaml`, `api-contract.md`, `data-model.md`, `data-model.dbml`) to the hashed and frozen
files; an approval that names no version is version 1 and keeps the older list, so a Change approved before the upgrade
does not turn into drift. `aidw approve` writes version 2; a Deviation's close keeps the approval's version, so a
contract the user never approved is never adopted into the package after the gate.

**Not built** (D10). Work outside the permission envelope is never done: `aidw not-built <T> --reason "..." [--cause
envelope|environment]` sets the task to `not_built` with `not_built: {cause, reason, at}`, and every open task that
depends on it to `not_built` with `cause: dependency`. `next` skips them and reports `complete` when the rest is done.

**Triage.** When a task runs out of attempts, a fresh `software-architect` Agent classifies the cause from the
evidence. It writes only its answer (`.aidw/run/triage-<task>.md`): the gate keeps the approved package and the
project files closed to it. After the Approval Gate nothing waits for the user (ADR-0014, plan D9); the CLI routes the
cause (`src/run.ts`, `recordTriage`):

| Cause | What the CLI does |
|---|---|
| `implementation` | grants one further attempt with the diagnosis in the brief; if that fails too, the task is not built |
| `plan`, `spec`, `architecture` | an **upstream round**: the owner in `artifacts.yaml` of the Artifact in question (`tasks` -> `technical-planner`, `delta-specs` -> `business-analyst`, `architecture` -> `software-architect`) fixes it under three rules (keep the purpose, smallest change, no new scope) through a Deviation, then the task reruns with a fresh attempt budget and is triaged again if it fails. At most `MAX_UPSTREAM_ROUNDS` (3) rounds per task; then not built |
| `environment` | not built at once: nothing inside the factory fixes a key or the network; the reason names the user's fix |

Triage may name the approved files at fault with a line `FILES: a, b`; their owner in artifacts.yaml is then the author
(`api-designer` for openapi.yaml, `database-architect` for the data model), else the Artifact of the cause (for a spec
cause on a task without specs: every delta spec of the Change). The round lives on the task (`upstream: { cause, role,
round, phase, deviation?, files? }`, a runtime field). `aidw next` returns `upstream` (step `open`); `aidw brief <T>
--for upstream` opens the round's Deviation (T9, `openDeviationFor`, with a reason that points at the diagnosis and the
upstream brief), writes the author's one brief and prints one `SPAWN` (one `author` run). While that Deviation is open
`aidw next` returns `upstream` step `author`, never the Deviation's own spawn. After `aidw deviation close`, `aidw
upstream <T>` reruns the task; it is refused while the round's Deviation is open or when it was abandoned. `--cannot
"<why>"` abandons an open one and marks the task not built; `aidw triage <T> --unclear` marks it not built when Triage
gives no clear cause twice.

**Not built.** A task the run cannot build gets status `not_built` and `not_built: { cause, reason, at }` (the shape of the Deviation record); every task that depends on
it, directly or not, and has not started or failed, gets the same with the cause `dependency`. Independent tasks carry on;
`aidw next` reports `complete` with the `not_built` list once nothing else is open, and `verifying` accepts not-built
tasks. The same holds after the tasks: a quality layer out of fix rounds is recorded `not_built` in the quality summary
and verify goes on with the next layers; an integration out of fix rounds is closed as not built; a converge gap whose
task was not built, or whose converge task did not close it, is listed under `not_built` and the converge passes.
A task not built after it ran on the main checkout leaves nothing behind for the next task's commit: what it left
uncommitted outside `.aidw/` is put back as HEAD has it, files it created are removed (paths already dirty when it first
started, `start_dirty`, are kept), and the list is recorded in `not_built.discarded`. Nothing is lost: first the
tracked edits are saved as `.aidw/run/evidence/notbuilt-<T>.patch` (`git apply` restores them) and the created files are
copied under `.aidw/run/evidence/notbuilt-<T>/`; `not_built.saved` and the reason name both. No Agent writes `change.yaml` (the
state and the approval record with `agent_run_cap`): the gate denies it, by Write, Edit or the shell.
Everything not built ends up in the pull request (a draft), never in a question.

**Agent runs and the cap** (plan D10, `src/agentruns.ts`). The CLI counts an Agent run when it prints its `SPAWN` line:
implementer (per attempt), reviewer (per attempt), triage, author (per round), integration and merge reviewer (per
conflict), consulted Role and resumed asker (per Consultation), layer reviewer (per round and commit). Each run has a key,
so a brief printed again is not counted twice; only runs after approval count. The record is
`evidence/agent-runs.json` (no Agent may write it; a record that cannot be read counts as the cap reached). The reviewer
key is the task's run counter, so a rerun after an upstream round or a retry is a new run. The cap is `grants.agent_runs`,
else 3 times the planned Agent runs (`plannedAgentRuns`: planned tasks x 2 for implementer and reviewer, plus one per
review layer; the plan review is before the gate), fixed in the approval record (`approval.agent_run_cap`) at `aidw
approve` so a Deviation that adds tasks does not move it. At the cap: `aidw task start` refuses a new attempt and `aidw
consult` a new Consultation; `settleChange` (run by `aidw next` and the commands that change state, never by the
read-only views) abandons an open upstream Deviation and marks every pending or failed task not built with the cap as
the reason, while running work (running, review, conflict) finishes; verify, integration and converge add no fix task
and mark what fails not built; review layers still run their reviewers. The Change then goes on to verify, deploy and
delivery: a clean end, ready for a draft pull request. The same settling marks tasks that can never run not built, and a
check the machine refused twice (`blocked_runs`, checkpoint or resolve) is an environment cause. Only the user raises
the cap after the gate: `aidw cap <id> --raise <runs>` (the gate asks every time, a headless run cannot answer it; it is
not a grant made ahead of time) adds to `approval.agent_run_cap`, appends `{ cap: { from, to }, by: user }` to
`approval.history` and rehashes: from package version 3 the cap and its raises are bound into the approval hash like
`approval.push`, so a hand edit is drift, and a raise is not a Deviation. It refuses under the runner, on a drifted
approval and while a Deviation is open (that closes against the hash it opened from).

**The pull request** (plan D12, `src/pr.ts`, `src/draft.ts`). The run always ends in one. It is **ready** when every
layer of the approved quality profile passed, converge passed with no scenario not built, the deploy succeeded and every
task is done; a **draft** otherwise (`prReadiness` names why). The body opens with three fixed sections, in this order,
"Nothing." when empty, all from records, never from an Agent's summary: *Differs from the approved package* (every
closed Deviation of `deviations.yaml`: reason, author Roles, summary, scenarios and requirements removed, added or
changed, removals with their reasons, contract classes, tasks added, removed and run again; the plan review graded the
package as it was approved), *Not built and why* (each task with its cause and reason, the dependants not built with it
and where its discarded work is; layers; converge scenarios; the cap with runs used), and *Needed from the user to
finish* (derived from the causes: what to provide for an environment cause, what to do by hand for work outside the
envelope or never automatic, `aidw cap` for the cap, a failed deploy, the plan-review findings carried from the gate,
the questions no Role could answer). Then the summary, tasks, evidence and merge danger as before.

Order at delivery: package, check, then `aidw pr <id>` (writes `.aidw/run/pr-<id>.md`, records `run.pr` in
change.yaml, prints ready or draft, whether the push is granted and a `NEXT:`), then `aidw pr <id> --create`, then the
archive. The push grant (ADR-0012) covers a Change still under `changes/` (open or `delivered`, `GRANT_STATES`), so the
pull request opens before `aidw archive`; `--create` commits `.aidw/` (the delivery package) first so the branch
carries it, and `aidw archive` pushes its own commit to the same branch when the pull request was opened and the gate's
own rule (`pushGrantReason`) still allows the push at that moment. A draft is not archived. Without the grant the gate
asks for `--create`; under the runner nobody can answer, so the session only writes the body and the runner ends with
the outcome `draft` (or `archived` for a ready Change) and a `NEXT:` naming `aidw pr <id> --create`: no hang. A deploy
that failed does not block the pull request: `delivered` needs a deploy that ran, not one that succeeded, and the
failure goes under "Needed". The work a not-built task left on the main checkout is saved under the machine-local,
uncommitted `.aidw/run/evidence/`; `aidw deliver` and `aidw pr` copy it into `changes/<id>/delivery/not-built/`, which
is committed with the package, because the pull request is read on another machine and must point at something there.
What git saw as changed is not proof it is safe to publish (a `.env.local` the project does not ignore, a key pasted
into a file), so the copy leaves out secrets files (`.env*` but `.env.example`), dependency and
build output, and any text with a line that looks like a credential (a patch as a whole when it touches one), and
writes `<T>.left-out.txt`; the pull request says what was left out and that it stays only on the machine.

Hardening (review of T11). Which pull request `--create` edits is never taken from change.yaml alone, which the lead
may write: the recorded URL must point at the bound remote's GitHub repository (this slug check applies only to a
GitHub remote; for another host the URL only has to be a pull request URL) and `gh pr view` must show it open, from
the Change Branch of the repository itself (`isCrossRepository` false, the head owner the remote's owner: a fork can
use the same branch name), against the base; otherwise the open one for the branch is looked up (`gh pr list --head
--base --state open`, same checks), else a new one is created. HEAD must be the Change Branch (for `--create` and `aidw archive`);
the push binding is checked again right before every push and `gh` call; the delivery commit runs the junk and secret
checks of a task commit, and nothing is pushed when the bookkeeping since the base holds a secrets file, build output
or a credential. `aidw archive` refuses a draft (computed again, not read from `run.pr`), and, with the push granted,
a Change whose pull request was never opened, unless `--force`; `--force` is the user's: the gate asks the lead for
it and an unattended session refuses it. Any Agent that runs `aidw archive` is asked. The last deploy must have run on
the current code too (its `head`, bookkeeping-only differences allowed). Readiness uses the current code: a layer or converge result counts only when HEAD
differs from where it ran by bookkeeping alone (`.aidw/`, README.md, .env.example, .gitignore). The plan-review
findings carried to the gate and the questions no Role could answer before it were approved knowingly: they go
under *Approved with open points* after the three sections, so a ready pull request needs "Nothing."; a question
after the gate that needed a Deviation nobody settled makes a draft. Under the runner, a machine check that fails
right before a deploy is recorded as a failed deploy (the command is not run) and the Change is delivered as a draft,
and a ready Change whose push was not granted ends with `needs_user` and the NEXT (`aidw pr <id> --create`, then
`aidw archive <id>`), never `no_progress`. The cap is hashed (package version 3): `aidw cap` rehashes, a hand edit is
drift.

**Finishing a draft.** `/aidw:resume` takes a delivered draft back to `executing` (`delivered: [executing]` in the
Workflow's state machine, refused when nothing can run again). `reopenDraft` brings back the tasks not built for the
environment, or at the cap once it was raised, with the tasks not built only because they depend on them; forgets the
layers not built so verify runs them; a failed deploy runs again at the end. Tasks not built after Triage, after their
fix rounds or outside the envelope stay so unless the user grants `aidw task retry <T>` (which accepts `not_built` and
brings the dependants back; never under the runner). At the end `aidw pr <id> --create` finds `run.pr` and updates the same pull request: push
again, `gh pr edit --body-file`, and `gh pr ready` when it became ready (`--undo` the other way).

## 8. Workflows

A Workflow is a YAML file the CLI reads (stages, Roles, Artifacts, Gates, Decision Points, retry policy) plus
the Markdown procedures inside the Roles' skills. One entry point serves all of them: `/aidw:start <request>`.
The Orchestrator proposes the Workflow, the user confirms, and a flag can name it up front.

### product (greenfield)

| Stage | Owning Role | Artifact | Gate |
|---|---|---|---|
| 1 Intake | Orchestrator | request, Workflow class | Decision: Workflow, confirmed by user |
| 2 Scope | `product-manager` | scope round of the discovery interview: vision, scope, MVP, out (in `analysis.md`) | Decision Page answered; CLI `analyze` checks it is recorded |
| 3 Requirements | `business-analyst` | requirements, specs per capability | CLI validates specs |
| 4 Design | `ui-ux-designer` | design direction, tokens | Decision: full design, reuse, or no UI |
| 5 Architecture | `software-architect`, `database-architect`, `api-designer` | architecture, data model, API contract, ADRs | artifacts valid |
| 6 Test plan | `qa` | test plan, test cases | every scenario has a test case |
| 7 Plan | `technical-planner` | task graph: Role, Slice, dependencies | Decision: shape of each Slice; CLI `analyze` |
| 7b Plan review | `code-reviewer` | verdict on architecture and plan against a fixed list | at most 2 fix rounds; open findings head the gate page |
| | | | **Approval Gate: design, architecture and plan** (the only one, ADR-0011) |
| 8 Build | implementation Roles | code and tests per task | CLI checkpoint, `code-reviewer` verdict; Decision: triage |
| 9 Verify | `qa`, `security`, `performance`, `ui-ux-designer` | quality report, fix tasks | every layer passes |
| 10 Converge | `qa` | scenario-to-test table | every scenario has a passing test |
| | | | **Gate: a production deploy asks first** |
| 11 Release | `release`, `devops` | deployment, smoke results | smoke checks pass |
| 12 Handover | `documentation` | delivery package | README commands run |

### Workflow files today

`workflows/product.yaml` (greenfield) and `workflows/feature.yaml` (brownfield) describe the flow aidw runs now, not
the 12 stages above: `product` has 17 stages and `feature` 18 (it adds the assessment), each tied to Change states,
with one approval gate; the only stage added since is the `plan-review` before it (section 7). The scope of `product` is a round of its discovery stage (`scope_round: true`):
the user answers the `scope` Decision Page, the answer is recorded under `### Scope round` in the discovery appendix of
`analysis.md`, and `aidw analyze` refuses the package without it. A Change created under that Workflow (named or by
default) records `scope_round: true`, so the check follows the Change, not today's Workflow file. Nothing is approved
there (ADR-0011). `aidw roster` checks
that a stage reads only what an earlier stage (or the project) already has, writes only what one of its Roles owns,
walks the Change state machine in an allowed order, and names the Agents the CLI spawns. The CLI reads the state
machine of a Change from its own Workflow file (`transitions`, `approval_required`, `analysis_required`) and the Agents
it spawns from `product.yaml`.

### feature (brownfield)

The product Workflow without the scope round. It starts with the existing-system assessment aidw already
does, then requirements. One Approval Gate before build (design, architecture and plan).

### bugfix

Reproduce with a failing regression test, diagnose, plan, plan review (section 7), fix, review, verify, converge,
handover. **No Approval Gate.** The boundary that keeps larger work out (Q40): after diagnosis the CLI checks the planned fix, and if
it changes behavior written in a spec, needs a migration, or needs more than 3 tasks, the Change is
reclassified to `feature` and stops at that Workflow's gate. A production deploy still asks.
The main session writes the diagnosis itself (no product-manager or architect Agent); only the planner is spawned. The red-first
claim is proved by the CLI, not taken from the implementer: the checkpoint runs the new tests on the base commit and fails a `fix`
task whose tests pass there. A task may name its commit `scope:`.

### audit

Read-only. A Decision Point selects the lenses (security, performance, code quality, UI). The matching
reviewers run on the current code and write one report with findings by severity. The user then picks
findings, and each pick becomes the input of a new `bugfix` or `feature` Change. No code changes, no gate.

## 9. Tasks and Slices

Every task has exactly one owning Role. The Technical Planner decides the shape of each Slice by criteria
written in its skill; the CLI warns when a plan departs from them.

- **Default:** one `fullstack` Agent delivers the whole Slice.
- **Split by Role** when at least one holds: the Slice adds or changes an API contract another Slice also
  uses; the Slice has a migration (always its own task); both sides are large enough that running them in
  parallel pays for the extra Agents.

A split Slice is a small graph: contract, then backend and frontend in parallel, then an integration task that
runs the scenario end to end.

## 10. Layout

Plugin:

```
plugins/aidw/
  roster.yaml          21 Roles: department, status and who carries whom
  artifacts.yaml       Artifact name -> path, owner, validation
  company/             rules for every Role (permissions.md today)
  roles/<id>/          role.md, rules.md, skills/, references/, scripts/, evals/
  workflows/<id>.yaml  product, feature, bugfix, audit
  library/             shared procedures and skills (implement-a-task.md, author-artifacts.md); vendor/ moves here
  stacks/              language packs (node.md) and framework packs; library/code-style.md holds the language-neutral rules
  agents/              GENERATED from roles/
  skills/              user commands: start, approve, run, resume, status, deliver, init
  hooks/  bin/aidw
```

Roles sit flat; the Department is a line in `role.md`, so moving a Role changes no path. Adding an employee is
one folder and one Roster line. Today's `profiles/`, `policies/` and `vendor/` move into `stacks/`,
`company/`, `library/` and the Roles that own that knowledge.

In the user's project, `.aidw/` keeps its current shape and gains `roles/<id>/` for Project Overlays.

## 11. Evaluation

- **Per Role:** an active Role ships at least one case in `roles/<id>/evals/` (an input and grading
  criteria). Editing a Role's knowledge is checked against its own cases without running a whole Workflow.
  `aidw eval [<role>] [--case <name>]` runs them: the Role's agent instructions (with every skill of its index inlined) are
  the system prompt, the case input is the task, and a second call grades the answer against each criterion (a missing
  verdict fails). The answering model is the one the Role's tier maps to in `tiers.yaml` (`--model` overrides it). It costs tokens, so it is run on
  demand and not part of `npm test`. One run is one sample of a model, so each case runs 3 times by default
  (`--runs <n>` changes it) and passes only when every run passes: a case that passes only some runs is FLAKY and
  counts as not passed (plan C2). A reply that is no deliverable (a refusal, a filtered reply) is an ERROR, not a FAIL.
- **Case front matter.** `case: <name>` (the file name), and optionally `covers: [B7, effects-after-commit]`, the rule
  ids of the Role's `rules.md` table and the skill names of its `role.md` index that the case checks, and
  `expect: ask` for a case whose right answer is a question (a hole in the contract: ask, do not guess). For an
  `expect: ask` case the runner drops the "do not stop to ask" line from the prompt and grades a short answer instead
  of calling it no deliverable; an empty reply or a refusal is still an ERROR.
- **A case fails without what it covers (plan C3).** `aidw eval <role> --without <id>[,<id>...]` takes those rule rows
  and skills out of the instructions and runs only the cases covering any of them (with `--case`, that case: pass all
  of its `covers` to test the case as a whole, since a rule and the skill that serves it say the same thing twice); each
  must fail, and one that still passes is printed as STILL PASSES (exit 1): rewrite or drop it. `aidw eval <role>
  --bare` is the baseline: the cases are answered with none of the Role's instructions, only the shared procedures it
  includes (`library/implement-a-task.md`, so the protocol for asking does not decide a case), and a case that passes is
  printed as PASSES BARE (exit 1). Both print every criterion's verdict, so a run is read per criterion, and never write
  the result file.
- **What C3 showed on the deep tier (owner decision 2026-11-24).** The first backend run (one run each, the claude
  CLI's default model) passed 4 of its 10 cases bare, with only `library/implement-a-task.md`, and the other 6 failed
  only on details (one missing test, one field of a log line), mostly the same ones with and without their covers; a
  rule and the skill that serves it are also restated in role.md, which `--without` never removes. On the deep tier the
  bare and `--without` runs are therefore a diagnostic, not a gate. "Fails without what it covers" is required on the
  tier a Role would be lowered to (before `tiers.yaml` maps it to a cheaper model) and at level 2 (C4, task T18), where
  a real task with tools gives the Role's knowledge room to matter.
- **Coverage (level 0, no tokens; plan C1).** For a Role whose `rules.md` is a table, `aidw roster` fails when a rule
  id or a skill of the Role has no case covering it. A `covers:` entry that names neither a rule id nor a skill of
  the Role fails for every Role. Roles still in prose are not held to coverage.
- **Result file (plan C6).** A run of all the cases of a Role (no `--case`, no `--without`), from a source checkout
  (the plugin root is in a git work tree) and on the tier's model, writes `roles/<id>/evals/results.json`
  (`format: 2`). The file holds the date of its last write, the model, the tier and a digest of the Role's shared
  content: every file under `roles/<id>/` but the result file and the case files (`evals/*.md`), the generated
  `agents/<id>.md`, the shared procedures its `includes` names, the library skills its index lists and `tiers.yaml`;
  dotfiles are left out and line endings are read as LF. The runner's own prompts (the answer and grading prompts
  in `src/evalrun.ts`) are not in the digest, and neither are the Role's scripts (`roles/<id>/scripts/`): level 1
  shows the model the Role's instructions and skills, never a script, so a script fix leaves its results standing.
  Each case entry holds its runs, pass or fail, the criteria that
  failed, the date that case ran, the model asked for and a digest of its case file. A model of `null` means the
  claude CLI's default on that entry's date, so a file merged over time can mix the defaults of different dates;
  the actual model is not detected. For a tier that maps to `inherit`, `--model` writes nothing. The digests are
  taken before the run starts, and if the shared content changes during the run nothing is written. A case's answer
  depends only on the shared content and its own case file, so `aidw eval <id> --case <name>` (same conditions)
  replaces only that case's entry. It needs an existing format-2 file from a full run, with the same shared digest
  and the same model; otherwise (including a file of the old format, one digest over the whole Role) it writes
  nothing and says to run all the cases. A run where no case was graded writes nothing; entries of deleted cases are
  dropped on each write. The file is committed with the change to the Role. For a table Role, `aidw roster` warns
  (it does not fail; `--strict` makes it fail) when the file is missing, when it was made on a model other than its
  tier's, when its shared digest differs (the Role changed after the last write: run all cases), when a case has no
  entry or one made from another version of its case file (run that case), when a case had fewer than 3 runs, or
  when a case did not pass. A file of the old format is still checked against the digest of the whole Role.
- **Level 2: a real task with tools (plan C4, `src/evallevel2.ts`).** `aidw eval <role> --level 2 [--case <name>]
  [--runs <n>] [--bare] [--model <m>]` runs each case of `roles/<id>/evals/level2/` from a source checkout, and must run
  outside Claude Code's own sandbox (the session it starts sets up its sandbox itself, and the grading uses
  `sandbox-exec` or `bwrap`). A case is a folder: `case.md` (front matter `case` = the folder name, `covers`, `fixture`,
  `task`, optional `change`, `must_read`, `must_not_read`, `restore`, `timeout_min` (default 25), `max_turns` (default
  60); `## Criteria` holds only what no machine can check), an optional `checks.yaml` (commands with an expected exit, a
  JSON subset of stdout or a regex; a bad `matches` regex is an error when the case loads), and `held-out/` (test files
  laid over the project at the same relative path after the session ends). A path in `must_read` is relative to the
  project, or `plugin:<path>` for a plugin file. Level 1 never reads these folders, and they are not part of level 1's
  shared digest.
- **The fixture.** `evals/fixtures/<name>` is a small real project with a committed lockfile and an aidw Change made
  with the CLI (for backend: `backend-api`, Express 5, TypeScript, PGlite, Vitest, Change `create-task`; one PGlite per
  test file with every table emptied per test, one HTTP server per test, files one at a time, so its suite holds under
  parallel load). Its files are what git lists in it. Its packages are installed once (`npm ci --ignore-scripts`, needs
  the network) into a cache keyed by the lockfile: `$AIDW_FIXTURE_CACHE`, else `$XDG_CACHE_HOME/aidw/fixtures`, else
  `~/.cache/aidw/fixtures`. The entry is made read-only and its digest is recorded in `.complete`; an entry that changed
  is refused (delete it to reinstall), and a finished entry is never deleted by a run. Each run copies the fixture to a
  fresh temp folder, links each cached package into a real `node_modules` folder, commits it to git, clones that base
  commit to `base.git` beside the project (read-only, its digest kept: the snapshot), and starts the task and writes its
  brief with the CLI's own code (`aidw task start`). The session's prompt is the orchestrator's: `Task brief: <path>.
  Read it and implement the task.`
- **What the session can reach.** The session sees a copy of the plugin without any Role's `evals/` folder (symlinks
  copied as the files they point to): its `--plugin-dir`, its `bin/` on PATH and every plugin path in the brief point
  at that copy, so the held-out tests, `case.md` and `checks.yaml` are not in it. Its settings allow reads outside the
  project only in that copy (none for a bare run); deny reads of the source checkout and its git common dir (whose
  history holds the hidden tests), the source repo's `evals/` and every `roles/*/evals/`; deny reading, editing and
  writing the run folder's own files (the snapshot, `settings.json`, `prompt.txt`, the log, the grading index); deny
  edits of the plugin copy and of the project's `.claude/`. The Role's cases folder and `evals/level2-reference/` are
  added to every case's `must_not_read`, and a tool call that so much as names the source checkout, its git dir, the
  snapshot or the settings fails the reads step.
- **The session.** One `claude -p --output-format stream-json --verbose --plugin-dir <plugin copy> --agent
  aidw:<role>` in the copy, with `--tools Read,Write,Edit,Glob,Grep,Bash`, `--permission-mode acceptEdits
  --permission-prompts none`, `--setting-sources project`, `--strict-mcp-config`, `--max-turns <n>` and a `--settings`
  file, in a trimmed environment (PATH, HOME, TMPDIR, the locale, the user, and what signs claude in and reaches it: API
  key, OAuth token, `CLAUDE_CONFIG_DIR`, Bedrock/Vertex, proxies, CA certificates; the calling session's `CLAUDECODE`,
  other `CLAUDE_CODE_*` settings, `ANTHROPIC_MODEL` and `MAX_THINKING_TOKENS` are dropped). No network: Bash runs only
  in Claude Code's sandbox (`failIfUnavailable`) with no allowed hosts, no local binding and no unsandboxed escape.
  The fixture's tests need no socket: `t.http()` in the backend fixture's `tests/helpers.ts` sends each request to the
  app in-process (`tests/http.ts`, a supertest-style client over an in-memory stream pair, through Node's HTTP parser),
  so no test binds a port and the session cannot reach a localhost port (`allowLocalBinding` would also open every
  localhost port on macOS, which a local proxy could carry out). Bash is allowed by a rule as well as for being sandboxed (the pilot's sandboxed loops and
  `$(…)` commands still asked for approval, which no one gives); it can run only sandboxed, and where the sandbox
  cannot start neither does the session; WebFetch and WebSearch are
  absent and denied. A watcher starts the session in its own process group, keeps the raw log, and stops the whole group
  at the limits (25 minutes; 60 turns, which `--max-turns` also enforces) or when it is stopped itself; it settles on the
  session's exit, so a background process left holding stdout cannot hold the run. Afterwards processes still working
  in the copy are killed (found with `lsof`, best effort). `--bare` drops `--plugin-dir` and `--agent`, and its brief has
  no Skills section, no rules of other Roles and no path into the plugin.
- **Before grading.** Nothing of the session's `.git` is read: the snapshot's digest is checked (a changed snapshot
  makes the run an ERROR), and every git the harness and the checks run uses the snapshot as `GIT_DIR`, the project as
  its work tree, an index and new objects in the run folder, no replace objects, and no excludes or attributes file.
  The `.gitignore` and `.gitattributes` files the session changed or added are put back from the snapshot (so no rule of
  its own hides a file or blanks a diff); then the diff and the list of changed files are taken against the snapshot
  (committed, replaced or excluded changes included); then files git ignores are removed (but `.aidw/`, which holds the
  report), the `node_modules` links are made afresh, and the files the grading runs are put back from the snapshot:
  `package.json`, the lockfile, `.npmrc`, `tsconfig.json`, the vitest and vite configs, `.gitignore`, and the case's
  `restore:` (the backend pilot: `tests/helpers.ts`). Held-out files are written only inside the project (a symlink on
  the way is removed).
- **Grading, in order.** (1) The held-out tests: with vitest from the cached packages and the fixture's own config
  (`node_modules/.bin/vitest run --config <config>`), else the fixture's `npm test -- <files>`; with vitest, a run that
  reaches fewer tests than `vitest list` collects from the held-out files fails. (2) The case's checks (the Role's
  scripts through `aidw plugin-path`; `$AIDW_BASE` is the starting commit, `$AIDW_CHANGED` names the list of changed
  files). (3) The tool log: each `must_read` file was read and no `must_not_read` one was (a Read of it, a Grep or Glob
  whose path holds it, or a part of a Bash command, split at `;`, `&`, `|`, that runs `cat`, `head`, `sed`, `grep`...
  and names it, or a `for f in <files>; do … cat "$f" …; done` loop whose list names it; a command that only prints
  a path does not count). (4) A model, with level 1's grader, given the brief
  and, fenced as data it must not take instructions from, the diff, the final reply and the report file; only for
  `## Criteria`, and only when 1 to 3 passed. The held-out files are removed again after step 1, so the checks see only
  the session's own tests (route-inventory's access tests must be the session's). The diff and the changed files are
  kept in memory from before step 1: each check gets them, and a git index of the base read through the snapshot, in a
  read-only folder of its own, and the run folder's records are written again after the checks. Each grading command
  gets only PATH, HOME, the locale, the user and a fresh scratch folder as TMPDIR (no keys, no proxies), processes it
  leaves in the copy are killed, and its report files are read out of the scratch folder. It runs confined: on macOS
  `sandbox-exec` with no network at all (no outbound connection, localhost and Unix sockets included, no bind) and
  writes only in the project, its scratch folder and `/dev`; on Linux `bwrap` with `/` read-only, the same writable
  places and an empty network namespace of its own, else `unshare -rn` (an empty network namespace, loopback down;
  writes not confined). The Linux paths were not tried here. Where none can be applied (inside another sandbox, a container without user
  namespaces) they run unconfined, the run records `none`, and the output says so. `AIDW_GRADE_SANDBOX=off` turns it
  off. A session stopped at a limit fails; one that never ran is an ERROR. A run passes when all four pass; a case
  passes with 3 of 3 runs. `--bare` (C3 at level 2) runs once by default and is judged by 1 and 2 only, with no model
  call: a case where any bare run passes prints PASSES BARE (exit 1).
- **Run folders.** Each run keeps its folder in the system temp dir (`aidw-l2-<role>-<case>-<n>-*`): `project/` (the
  copy), `plugin/` (the session's plugin, without Roles' cases, also behind a symlink), `base.git` (the snapshot), `session.jsonl`, `diff.patch`, `changed.txt`,
  `held-out.txt`, `held-out.json` and `held-out-list.json`, `checks.txt`, `settings.json`, `prompt.txt` and
  `result.json`; the path is printed. They are not removed; delete them when done (`chmod -R u+w` first: the snapshot is
  read-only). A copy that cannot be prepared keeps `result.json` only.
- **Level 2 result file.** `roles/<id>/evals/level2/results.json` (`format: 2`, `level: 2`), written under level 1's
  rules (source checkout, tier's model, `--case` merges, nothing written when content changed during the run). Its
  shared digest is level 1's with the Role's scripts added (a session runs them); each entry adds the digest of its case folder and of its fixture, and how its grading was
  confined (`gradingSandbox`: `sandbox-exec`, `bwrap`, `unshare` or `none`). A run whose grading ran with `none` writes
  nothing unless `AIDW_GRADE_SANDBOX=off` was set. For a Role with level 2 cases, `aidw roster` warns (never fails
  without `--strict`) when the file is missing, made on another model, older than the Role, a case folder or a fixture,
  from fewer than 3 runs, not passed, or graded with `none`. A malformed level 2 case is an error, as for level 1.
- **Proven by the backend pilot** (6 real sessions, 2026-11-26): `--agent aidw:<role>` with `-p` runs the Role's
  agent as the main session; `--setting-sources project` keeps the user's own `~/.claude/CLAUDE.md` out of the
  session; the sandbox is applied to Bash (it refused a local `listen`, `EPERM`, which the in-process test client
  now avoids).
- **Not yet proven by a real run:** that the sandbox keys block outbound network as intended (no session tried it),
  that the `Read(...)` deny rules also stop a sandboxed Bash `cat`, and that the sandbox lets Bash write nowhere but the
  project (if it can write the run folder, the snapshot's digest still turns a changed snapshot into an ERROR).
- **Residual risks.** Where no grading sandbox can be applied, the held-out tests and checks run code the session wrote
  with the user's own rights and network (such runs record `none` and are not written by default); there the graded code
  can also rewrite the run folder's files while it runs, though the grading reads its inputs from memory and fresh
  folders and writes the records again. `unshare` on Linux confines only the network. Killing leftover processes depends on `lsof` seeing them. The `Read(...)` deny rules and
  the tool log are the only guards on what the session reads; a read through a path they do not name (another copy of
  the repository elsewhere on the disk) is not caught.
- **End to end:** the existing fixtures (`evals/fixtures/brownfield-app`, `greenfield-jd`) and `aidw cost`,
  which already reports cost per agent type, catch coordination problems and cost regressions.

## 12. Proposed here, not decided in the interview

These follow from the decisions but were not put to the user as questions. Each needs a yes or a correction.

1. **Default run modes.** Interactive: `product-manager`, `business-analyst`, `ux-research`, `ui-ux-designer`
   (design; its review side runs as worker), `software-architect` (architecture; triage runs as worker).
   Worker: every other Role.
2. **Starting tiers.** `deep` (the session's own model): `software-architect`, `technical-planner`,
   `product-manager` and the implementation Roles, so that today's behavior is kept. `standard`: the
   reviewing Roles, which already run on a smaller model today. `fast`: `documentation`, `release`.
3. **Agent names change** from `aidw:implementer`, `aidw:reviewer`, `aidw:security-reviewer`,
   `aidw:ui-reviewer` to `aidw:fullstack`, `aidw:code-reviewer`, `aidw:security`, `aidw:ui-ux-designer`.
   Behavior stays the same; the names appear in the `run` skill, `aidw cost` and the tests.
4. **Bugfix reproduction in the first version** is done by the Role that owns the affected layer (as the
   implementer does today), until `qa` is active.
5. **A no-gate Workflow and the gate hook.** The hook denies writes outside `.aidw/` before approval. For
   `bugfix` the CLI records an automatic approval once the plan passes the Q40 boundary check, so the hash and
   drift protection still apply to what runs.
6. **Triage budget.** One triage per failure; an `implementation` cause grants one further attempt, then the
   task is not built; an upstream cause grants up to three rounds by the author Role (ADR-0014).

## 13. Migration

Four steps. Each is its own Change, keeps the test suite and both fixtures green, and can ship alone.

| Step | What | Done when |
|---|---|---|
| 1 | `roles/` for all 21 (9 active with the knowledge moved from today's agents and skills, 12 planned with a profile only), `roster.yaml`, the agent generator in the build, a CLI check of Roster and profiles | generated agents behave as today's four; no workflow behavior changes; existing tests pass with the new names |
| 2 | `workflows/product.yaml` and `feature.yaml` drive `aidw next` for the flow that exists today; `artifacts.yaml`; consistency checks; interactive Roles interview, worker Agents draft | a run on each fixture takes the same path and passes the same gates as before, with a smaller main-session context |
| 3 | Decision Points, triage, Slice shape with `frontend` / `backend` assignment, the scope gate for `product` (since replaced by a scope round, ADR-0011); `bugfix.yaml` and `audit.yaml` | each Workflow runs end to end on a fixture; a forced spec-caused failure reaches the user with a diagnosis instead of three retries |
| 4 | Activate Planned Roles one at a time, each with its evals; framework packs for Next.js and NestJS | a Role is activated by deleting its `carried_by` line and adding knowledge, with no CLI change |

Filling Roles with knowledge and skills (the user's stated next phase) starts once step 1 lands and continues
through step 4.

## 14. Limits kept from aidw

One Change at a time per project. No monorepo support. Task commits go to the change branch; aidw never
merges, and pushes without asking only the Change Branch and its one pull request, when the Approval Gate granted it
(ADR-0012, `grants:` in `quality.yaml`). Role, skill and Workflow files are written in English; the factory talks with
the user in the user's language. The commands `/aidw:start`, `approve`, `run`, `resume`, `status` and
`deliver` keep their names through all four steps. The gate's Bash patterns stay a first line of defense, not a
sandbox: a Role denied Bash writes is also denied inline interpreter code (`node -e`, `python -c`, `bash -c`...),
protected paths are matched without case, and a command split into words for an allow holds only space and tab
(`company/permissions.md`); what still slips through is surfaced by the Stop-hook backstop.
