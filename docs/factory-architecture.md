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
  They never change code.

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
skills:                    # on-demand: roles/<id>/skills/<name>.md, read only when the condition holds
  - rest-contract:   when designing a new endpoint
  - breaking-change: when changing an existing contract
---
## Responsibility
## Procedure
## Done when
## Stop and report when
```

`access` tells the gate what the Role's Agent may write: `write` edits project files (implementing Roles, never
`.aidw/`), `artifacts` drafts under `.aidw/` only, never project files (the gate's normal rules also apply inside `.aidw/`:
the approved package is frozen), `read-only` writes only a verdict. `includes` appends shared text such as the
procedure all implementing Roles follow, so it exists once. `reads` and `writes` list Artifact names from
`artifacts.yaml`; the profile's text still names the paths for the Agent, and `aidw roster` checks the names.

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
direction, an escalated task's decision, the audit pick list and both Approval Gates. The user's choices come back as
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
| 2 Scope | `product-manager` | product brief: vision, scope, MVP | artifact valid |
| | | | **Approval Gate 1: scope and MVP** |
| 3 Requirements | `business-analyst` | requirements, specs per capability | CLI validates specs |
| 4 Design | `ui-ux-designer` | design direction, tokens | Decision: full design, reuse, or no UI |
| 5 Architecture | `software-architect`, `database-architect`, `api-designer` | architecture, data model, API contract, ADRs | artifacts valid |
| 6 Test plan | `qa` | test plan, test cases | every scenario has a test case |
| 7 Plan | `technical-planner` | task graph: Role, Slice, dependencies | Decision: shape of each Slice; CLI `analyze` |
| | | | **Approval Gate 2: design, architecture and plan** |
| 8 Build | implementation Roles | code and tests per task | CLI checkpoint, `code-reviewer` verdict; Decision: triage |
| 9 Verify | `qa`, `security`, `performance`, `ui-ux-designer` | quality report, fix tasks | every layer passes |
| 10 Converge | `qa` | scenario-to-test table | every scenario has a passing test |
| | | | **Approval Gate 3: only for a production deploy** |
| 11 Release | `release`, `devops` | deployment, smoke results | smoke checks pass |
| 12 Handover | `documentation` | delivery package | README commands run |

### Workflow files today

`workflows/product.yaml` (greenfield) and `workflows/feature.yaml` (brownfield) describe the flow aidw runs now, not
the 12 stages above: `product` has 13 stages and `feature` 14 (it adds the assessment), each tied to Change states,
with one approval gate and no new stage. `aidw roster` checks
that a stage reads only what an earlier stage (or the project) already has, writes only what one of its Roles owns,
walks the Change state machine in an allowed order, and names the Agents the CLI spawns. The CLI reads the state
machine of a Change from its own Workflow file (`transitions`, `approval_required`, `analysis_required`) and the Agents
it spawns from `product.yaml`.

### feature (brownfield)

The product Workflow without stage 2 and Gate 1. It starts with the existing-system assessment aidw already
does, then requirements. One Approval Gate before build (design, architecture and plan).

### bugfix

Reproduce with a failing regression test, diagnose, fix, review, verify, converge, handover. **No Approval
Gate.** The boundary that keeps larger work out (Q40): after diagnosis the CLI checks the planned fix, and if
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
| 3 | Decision Points, triage, Slice shape with `frontend` / `backend` assignment, the scope gate for `product`; `bugfix.yaml` and `audit.yaml` | each Workflow runs end to end on a fixture; a forced spec-caused failure reaches the user with a diagnosis instead of three retries |
| 4 | Activate Planned Roles one at a time, each with its evals; framework packs for Next.js and NestJS | a Role is activated by deleting its `carried_by` line and adding knowledge, with no CLI change |

Filling Roles with knowledge and skills (the user's stated next phase) starts once step 1 lands and continues
through step 4.

## 14. Limits kept from aidw

One Change at a time per project. No monorepo support. Task commits go to the change branch; aidw does not
merge or push without asking. Role, skill and Workflow files are written in English; the factory talks with
the user in the user's language. The commands `/aidw:start`, `approve`, `run`, `resume`, `status` and
`deliver` keep their names through all four steps.
