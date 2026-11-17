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

**Decision Page**:
A throwaway view that lays the options of one round of questions or one Approval Gate side by side so the
user can choose; the choices it yields are recorded in Artifacts, and the page itself is not one.
_Avoid_: Artifact, report, form

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

### Design

**Design Direction**:
The look chosen for one product: its character, type, color, density and layout, and the exceptions it allows itself.
_Avoid_: Theme, style, brand

**Brand**:
The name and the mark of one product. It is separate from the Design Direction, which is how the product looks.
_Avoid_: Identity, logo (when the name is meant too), Design Direction

**Design Mock**:
A static screen that shows one Design Direction at real size. Candidates are compared by the user; the approved
one is an Artifact, and the screens built later follow its structure and treatment.
_Avoid_: Prototype, wireframe, mockup, Decision Page

**Direction Library**:
The Design Directions the factory keeps, each accepted by the factory's owner, from which the candidates for a
product are dealt.
_Avoid_: Theme pack, presets, templates

**Screen Kind**:
What a screen is for: an app screen (operated) or a landing page (read). A Design Direction sets rules per kind.
_Avoid_: Page type

**Usability Rule**:
A rule about whether a person can do the job on a screen, with its source and a fixed severity: blocking, fix or
remark. It applies to every project, on the screens a Change touches.
_Avoid_: UX law, heuristic, best practice, guideline

**Dark Pattern**:
A design that deceives or traps the people who use the product (false urgency, false social proof, hidden costs,
a cancellation harder than the sign-up). The factory does not build one.
_Avoid_: Growth tactic, nudge

**Slop Check**:
A deterministic check for the signs of a generic generated interface, applied to a Change whose design the factory
authors; only an exception written in the approved Design Direction lifts one of its rules. It is not a Guard:
failures of use (contrast, overflow, clipped text, a blank state) are checked by a Guard on every project.
_Avoid_: Guard, lint, taste review
