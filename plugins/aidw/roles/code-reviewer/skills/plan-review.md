---
name: plan-review
description: Grade the architecture, plan and test plan of a change before its approval gate against a fixed list of four items, with findings the authoring Roles can act on.
---

# Reviewing architecture and plan before the gate

The user approves the package once, at the gate; after that the build runs without asking. Whatever is wrong in the
plan now is built, reviewed and paid for task by task. Your job is to find what would go wrong, cheaply, while
fixing it is a text edit.

`aidw analyze` has already passed: every section is filled in, every changed scenario is named by at least one task,
tasks are well formed. Do not repeat those checks. Judge what a check cannot: whether the plan does what the
package promises, no more, the way the constitution says.

## The list

Grade against these four items and nothing else. Every finding cites one item.

1. **Every approved scenario has a task that really delivers it.** For each scenario the brief lists, find the task
   that names it and read the task as an implementer would: its `touches`, its verify commands, its owner. A
   scenario whose WHEN is a user action needs a task that builds the screen and tests it through the screen; an
   unhappy path (refused, empty, too many, not allowed) needs a test that drives it, not only the happy one. A task
   that names a scenario it cannot deliver is a finding against the scenario.
2. **No task outside the approved scope.** Read `## Requirements and scope` and the requirements: a task, a field, an
   endpoint or a screen that no requirement asks for is a finding, even when it looks useful. "Out" items of the
   scope round are hard limits.
3. **The architecture and the plan follow the constitution.** Read the constitution's rules (stack, structure,
   testing, conventions) and the Decisions to honor, then look for a task or an architecture choice that breaks one:
   a second state store, a test layer the constitution forbids, a folder layout it does not allow.
4. **No needless complexity.** A queue, cache, abstraction layer, extra service, plugin system or generic framework
   that no scenario needs; a task split into pieces that cannot be tested alone; a contract designed for clients
   that do not exist. The simplest plan that delivers every scenario is the right one.

## How to work

- Work scenario-first: list the scenarios, then walk the tasks for each. Then walk the tasks once more for anything
  that serves no scenario (items 2 and 4).
- Read the test plan with the tasks: a test case that no task's verify command will ever run is an item 1 finding
  against the scenario.
- On a later round the brief lists the findings of the round before. Check each one first: fixed, or still open as
  written (repeat it, sharper if you can). Then look for what the fix itself broke. Do not hunt for new taste issues
  to fill the round.
- You are read-only. Do not rewrite the plan in your verdict; say what is wrong and what the fix must achieve. The
  Role that wrote the part fixes it.

## Writing a finding

`N. [item K] <task id | scenario id | area>: <what is wrong, with the evidence> -> <what the fix must achieve>`

- One target per finding: a task id (`T03`), a requirement or scenario id exactly as `aidw ids` prints it, or an
  area (`architecture`, `constitution`, `contracts`, `test-plan`, `quality`). The CLI refuses any other name.
- The evidence is a quote or a pointer (the task's `touches`, a line of the constitution), not an impression.
- Only a broken item justifies `fix`. A better name, a nicer order of tasks or a wish goes under `Non-blocking:`.
- `pass` when the four items hold. Do not invent a finding to look thorough.

## Right and wrong

Right: the finding names one scenario, quotes the evidence, and says what must be true afterwards.

```
VERDICT: fix
1. [item 1] booking/cancel-appointment/late-cancel-refused: T04 names it, but its verify runs only `vitest lib/booking` and no task touches the cancel button's error state -> a task whose touches include the cancel screen and an e2e test that cancels within 24 hours and sees the refusal
2. [item 4] architecture: a Redis cache for free slots, while every scenario reads one clinic's slots for one day -> read slots from Postgres; drop the cache and its task T06
Non-blocking:
- T02 and T03 could share one fixture file
```

Wrong: no item, no target the CLI can check, taste mixed with blocking issues, and a rewrite instead of a finding.

```
VERDICT: fix
- The plan feels too big and some tests seem missing.
- I would rename T02 to "Slots API".
- Rewrite tasks.yaml as follows: ...
```

## Sources

Ideas, not wording: the cross-artifact consistency pass of GitHub's spec-kit `analyze` (coverage gaps between
requirements and tasks, alignment with a constitution); the plan review step of obra/superpowers `writing-plans`
(each task small, testable alone, nothing speculative); the YAGNI and simplicity axis of Addy Osmani's
`code-review-and-quality`, vendored and read with the task reviews.
