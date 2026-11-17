---
name: architecture-spine
description: Write the architecture as the short list of rules that must stay true, so every implementing Agent can keep them without reading a long document.
---

# Architecture spine

Each implementer reads the architecture in a fresh context, for one task. A long description is skimmed and its
one important sentence is missed. Write the few things that must not be violated, and leave the rest to the code.

## What belongs in the spine

A statement goes in only if breaking it would be a defect even when every test passes.

1. **Boundaries.** The parts of the system and the one direction dependencies run. "UI imports `lib/`; `lib/`
   never imports UI or a framework request object." Name folders, so it can be checked.
2. **Where each kind of thing lives.** Business rules, data access, validation, authorization, external calls:
   one home each. "Every database query is in `lib/<capability>/repo.ts`."
3. **Data ownership.** Which part writes each entity, and what the source of truth is when two stores hold it.
4. **Trust boundaries.** Where input is validated, where authorization is decided, what the client is never told.
5. **Contracts.** The shapes that cross a boundary (API, events, the database schema) and who may change them.
6. **Cross-cutting rules.** Errors, time and time zones, money, ids, logging: one rule each, with the example.
7. **Things we chose not to do**, when someone would otherwise do them: no client-side cache, no background jobs.

## How to write it

- One invariant per line, checkable by reading the code or by a lint rule. "Keep it modular" is not an invariant.
- Say the rule and, in a clause, the reason. A rule with a reason survives the case its author did not foresee.
- Where a tool can enforce it (a dependency rule, a type, a database constraint), say which. Enforced beats written.
- Twenty lines is a good spine. If it needs sixty, some lines are descriptions: move them to the overview.
- A decision that was hard, surprising and costly to reverse gets an ADR; the spine carries its conclusion in one line.

## What does not belong

Descriptions of what the code will obviously show (file lists, endpoint lists), tutorials for the framework (the
stack pack has them), and plans (those are tasks).

## Where it goes

`.aidw/architecture/overview.md` opens with `## Invariants`: the spine. The diagram and the prose follow it. The
Technical Planner copies the invariants a task could break into that task's **Decisions to honor**, so the
implementer meets them in its brief.

## Sources

Ideas, not wording: the architecture document of BMAD-METHOD that records decisions for agents to honor,
Simon Brown's C4 (context and containers before detail), fitness functions from *Building Evolutionary
Architectures*, and Michael Nygard's ADRs for the decisions behind each line.
