---
name: start
description: Start an aidw change from an idea, PRD, Upwork job description, client request or existing codebase, and run the whole Analysis up to the single approval gate. Use when the user runs /aidw:start.
disable-model-invocation: true
argument-hint: "<idea text | path to PRD/JD | 'this codebase'>"
---

# aidw: start a change and run the Analysis

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

Run `aidw status`. If it reports no `.aidw/`, run the `/aidw:init` steps first (`aidw init`). If a change is
already `awaiting_approval` or later, tell the user and stop: one change at a time.

## 1. Intake

1. Pick a change id: `YYYY-MM-DD-<short-kebab-slug>` (today's date).
2. `aidw change new <id> --title "<title>" --input-type <idea|prd|upwork_jd|client_request|codebase>`
3. `aidw transition <id> intake`
4. Fill `.aidw/changes/<id>/intake.md`: paste the original request **verbatim** (or its path), record the
   client's explicit constraints, including any stack the client requires.

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

## 5. Design decision (Q3)

Detect design assets: Figma links, screenshots, an existing design system, brand guides. Then choose the
mode with the user:

- `existing`: assets exist. Collect them into `.aidw/design/` (Figma via the Figma MCP tools, screenshots, notes).
- `claude_design`: the user designs in Claude Design. Ask them to export it ("Send to local coding agent")
  and save the bundle under `.aidw/design/`. Wait for it; this happens before approval.
- `ai_design`: write `.aidw/design/direction.md`: personality, color tokens, typography, spacing, key layouts,
  references. The user approves the look at the gate.
- `hybrid`: say which parts follow references and which parts AI designs.

## 6. Architecture and stack

1. Read `$(aidw plugin-path profiles/stack-pool.md)` and apply its priority: **client > AI within the pool >
   fallback**. Record `Source: client|ai|fallback` and the reasons.
2. Write `.aidw/architecture/overview.md`: components, data model outline, folder structure, integrations,
   auth and payment choices.
3. ADRs for hard-to-reverse, surprising, real trade-offs only (domain-modeling's rule).
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
- The first tasks usually scaffold the project with the approved stack and set up the test harness, the
  JUnit reporters of quality.yaml, and `.env.example` for every environment variable (names only).

## 8. Quality, deploy and permissions

Read `$(aidw plugin-path profiles/quality-layers.md)` and `$(aidw plugin-path policies/permissions.md)`.

- Write `.aidw/changes/<id>/quality.yaml`: the layers with the exact commands for the chosen stack, the deploy
  target and command, the smoke checks, and the tier-2 resource keys. These commands run unattended after
  approval, so make them non-interactive.
- `## Quality profile`: which layers run and why (code, unit, integration, e2e now; ui-ux, a11y, security,
  performance later), scaled to the project's risk (Q5: comprehensive by default). Justify any dropped layer.
- `## Deploy strategy`: none | local | preview, the provider, the preview environment variables and where their
  values come from. Production is never automatic: it is tier 3 and asks.
- `## Permissions`: one bullet per tier-2 resource, starting with its key, e.g.
  ``- `vercel-preview`: preview deploy of the demo, deleted after handoff``, or `None`. `aidw analyze` checks
  that every key in quality.yaml is named here.

## 9. Analyze and present

1. Complete every section of `.aidw/changes/<id>/analysis.md`. Replace every `TODO(aidw)`. The `## Summary`
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
