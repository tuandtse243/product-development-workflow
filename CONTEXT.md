# aidw Software Factory

A plugin that works like a small software company inside any project: it turns a request into verified
software through defined roles, workflows and gates, with a human approving the important decisions.

## Language

### Organization

**Role**:
The definition of one position in the factory: its responsibility, rules, skills and reference material.
_Avoid_: Employee, nhân viên, agent (when the definition is meant)

**Agent**:
One run of a Role on one piece of work.
_Avoid_: Role (when a single run is meant), worker, bot

**Department**:
A group of Roles that share a phase of the work: Product & Analysis, Architecture & Planning,
Implementation, Quality & Delivery.
_Avoid_: Group, team

**Roster**:
The list of every Role the factory declares, each marked active or planned.
_Avoid_: Agent list, registry

**Active Role**:
A Role that workflows may assign work to.

**Planned Role**:
A Role declared in the Roster whose work is carried by another Role until it is activated.
_Avoid_: Stub, placeholder

**Orchestrator**:
The coordinator of a run: the main session together with the CLI. It is not a Role and is not in the Roster.
_Avoid_: Manager agent, supervisor

**Run mode**:
How a Role's Agent runs: interactive (in the main session, talking with the user) or worker (in a fresh context).

### Work

**Workflow**:
The ordered stages, Roles, artifacts and gates used for one kind of request.
_Avoid_: Pipeline, process

**Change**:
One request moving through a Workflow, from intake to delivery.
_Avoid_: Ticket, job, project

**Artifact**:
A persistent output of a stage that a later Role reads instead of chat history.
_Avoid_: Document, output

**Gate**:
A condition that must hold, with evidence, before a Change moves to the next stage.

**Guard**:
A deterministic check the factory itself enforces on every project, whatever tooling the project has; when it
fails, the work is refused or sent back.
_Avoid_: Gate (a Gate is the condition; a Guard is a check that enforces one), lint rule, hook

**Approval Gate**:
A Gate that only the user can pass.
_Avoid_: Checkpoint (that word means the per-task evidence check)

**Decision Point**:
A place a Workflow declares where a named Role chooses one answer from a fixed set.
_Avoid_: Branch, detour

**Triage**:
The independent diagnosis of why a task ran out of attempts: implementation, plan, spec, architecture or environment.
_Avoid_: Debugging, post-mortem

**Slice**:
The tasks that together deliver one behavior end to end; the Technical Planner gives it to one Agent or
splits it by Role along a contract.
_Avoid_: Feature, story

### Knowledge

**Tier**:
The class of model a Role needs (deep, standard or fast), named without naming a model.

**Skill**:
A procedure a Role follows for one kind of work, loaded only when that work comes up.

**Vendored Skill**:
A Skill copied word for word from an outside source and never edited by the factory.
_Avoid_: Third-party skill, imported skill

**Authored Skill**:
A Skill the factory writes itself, naming the sources whose ideas it draws on.
_Avoid_: Custom skill, own skill

**Stack Pack**:
The knowledge about one technology that any Role loads when the project uses that technology.

**Project Overlay**:
Rules and reference material a project adds to a Role without replacing the Role's own definition.
_Avoid_: Override, customization
