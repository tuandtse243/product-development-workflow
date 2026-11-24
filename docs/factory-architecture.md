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

`fullstack` is the one Role added to the user's original 20. It is today's `implementer` with a profile; its
skill index points at the `frontend` and `backend` skills, so no knowledge is copied.

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
first framework packs.

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
| Where to go after repeated failure | `software-architect` with the triage skill | upstream causes go to the user |

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
tool at its exact path (every other Agent and the Orchestrator are denied, a Bash write naming the file too), the
approval hash reads those files as they were when it opened, so an edit to any other approved file is still drift,
and while `quality.yaml` is open the grants and the tier 2 permissions are read from its approved copy. `next` returns
the Deviation first, with `meanwhile` for work already in flight (none when `tasks.yaml` is open: the CLI would record
progress in the file being edited). `aidw deviation close [--remove-reason R] [--scope-reason R] [--summary S]` checks
what the CLI can check:

| Check | Refused when |
|---|---|
| drift | another approved file changed (named, from the per-file digests) |
| half written | `openapi.yaml` does not parse, `data-model.dbml` has an unclosed block, a new or changed scenario lacks its WHEN or THEN |
| grants | `grants` or `permissions` in quality.yaml changed: they are the user's |
| package | `aidw validate` + `aidw analyze` report an error on the changed package |
| scenarios | an approved scenario is gone with no reason (`--remove-reason "<why>"` for all, or `"<scenario>=<why>; ..."`) |
| scope | a new requirement without `--scope-reason`; a new scenario under no approved requirement |
| tasks | a new planned task lists no approved scenario under `scenarios:` |
| in flight | a task that must run again (other than the one the Deviation names) is running, in review or in conflict: wait for it to settle |
| contracts | never refused: `openapi.yaml` and `data-model.dbml` are classified additive, breaking or, when the text changed with no difference the CLI can classify, unclassified (`src/contractdiff.ts`: operations, parameters, bodies, responses, schema properties, required, types, enums; tables, columns, a new NOT NULL column without a default, enums); `api-contract.md` and `data-model.md` are `prose`, or decided by `openapi.yaml` / `data-model.dbml` when the Change has one |

Then, in one step, it records the closed Deviation and rehashes the package with `approval.package: 2` (`approval.push`
is read from the record and kept, so the push grant still holds), appending `{deviation, previous, hash, reason, roles,
files, at}` to `approval.history`; only after that does it reset tasks, so a Change in verifying or converging returns
to executing on a valid approval. The tasks to run again: tasks whose planned fields changed, whose scenarios were
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
does not turn into drift. `aidw approve` and a Deviation's close write version 2.

**Not built** (D10). Work outside the permission envelope is never done: `aidw not-built <T> --reason "..." [--cause
envelope|environment]` sets the task to `not_built` with `not_built: {cause, reason, at}`, and every open task that
depends on it to `not_built` with `cause: dependency`. `next` skips them and reports `complete` when the rest is done.

**Triage.** When a task runs out of attempts, a fresh `software-architect` Agent classifies the cause from the
evidence. It writes only its answer (`.aidw/run/triage-<task>.md`): the gate keeps the approved package and the
project files closed to it. One triage per task; `implementation` grants one further attempt, then the task escalates:

| Cause | What the CLI does |
|---|---|
| `implementation` | grants a further bounded attempt with the diagnosis in the brief |
| `environment` | escalates with the exact thing the user must fix |
| `plan`, `spec`, `architecture` | stops; the user sees the diagnosis and decides, because the approved package would change |

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
  `aidw eval [<role>] [--case <name>]` runs them: the Role's agent instructions are the system prompt, the case input is the
  task, and a second call grades the answer against each criterion (a missing verdict fails). It costs tokens, so it is run on
  demand and not part of `npm test`. One run is one sample of a model, so `--runs <n>` runs each case n times and calls a case that passes only some of them FLAKY; a reply that is no deliverable (a refusal, a filtered reply) is an ERROR, not a FAIL.
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
6. **Triage budget.** One triage per task; an `implementation` cause grants one further attempt, then the
   task escalates.

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
