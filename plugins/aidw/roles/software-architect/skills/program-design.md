---
name: program-design
description: Write the Program Design of a Change - the file-tree diff and the main signatures and contracts, with call trees, component trees, a dependency map or pseudocode where they help - after the system design round.
---

# Program Design

The System Design says how the parts work together; the Program Design says what the code will look like. The user
approves it at the gate with the rest of the package, the Technical Planner cuts the tasks from it, and an
implementer who needs a different file or signature stops and reports instead of building around it: a difference
from the approved Program Design is a Deviation (ADR-0015). Write only what binds: the shapes a reviewer can hold the
code to.

## Read first

The answers of the round (`### System design round` and the settled `### Design Questions` in `## Architecture` of
`analysis.md`), `.aidw/architecture/overview.md`, the constitution, the delta specs, and the contracts when they exist
(`data-model.md`, `api-contract.md`, `openapi.yaml`). In an existing codebase read the files you will mark changed:
the diff is against what is there today, and the Existing System Report (`existing-system.md`) says where things are.

## The file: `.aidw/changes/<id>/program-design.md`

Headings that the CLI reads stay as written. Two parts are required:

- `## File tree`: one fenced block, one path from the project root per line, marked `+` new, `~` changed, `-`
  removed, with a few words on what each file is for. `aidw analyze` refuses a `~` or `-` path that does not exist
  and warns about a `+` path that already does.
- `## Signatures and contracts`: the main exported functions, types, routes, events and table shapes, each in a
  fenced block. A shape that exists today is a ` ```diff ` block (context lines kept, `+` and `-` for what changes);
  new code is shown in full. Name the file in a comment on the first line of each block.

Add these only where they make the shape clearer than the signatures alone:

- `## Call trees`: who calls whom for one flow, from the entry point to the store.
- `## Component trees`: the UI components a screen is made of, and which one owns which state.
- `## Dependency map`: which module may import which, when the Change adds a boundary.
- `## Pseudocode`: the order of steps of a rule that is easy to get wrong (a retry, a lock, a migration).

A `Size: small` Change gets the short version: the file tree and the signatures, nothing else.

## Right and wrong

Right: a signature the planner can cut a task from and a reviewer can check.

```diff
 // lib/booking/repo.ts
 export async function createAppointment(slotId: string, patientId: string): Promise<Appointment>
+export async function moveAppointment(id: string, toSlotId: string): Promise<Appointment> // throws SlotTaken
```

Wrong: a description of intent ("the repository will get a method to move appointments"). It binds nothing, so code
that differs from it cannot be told from code that follows it.

## Done when

Every file a task will touch is in the file tree, every contract another part calls has its signature, a changed
shape is a diff, a new one is whole, and `aidw analyze <id>` reports nothing about `program-design.md`. Reply with the
path, the number of files per mark, and any shape you could not settle (it goes back to the round, not into the code).

## Sources

Ideas, not wording: HumanLayer `rpi` (MIT, github.com/humanlayer/skills, `plugins/rpi`): the references
`create-structure-outline` and `iterate-structure-outline` (a change outline of file trees, contracts, call trees,
component trees and pseudocode chosen for what they explain; focused diffs for existing shapes and full target
shapes for new code), `create-design-discussion` (settled choices carried into the outline), and `show-me` (the tree
format and the smallest view that shows the point).
