---
name: task-interfaces
description: Cut the tasks from the Program Design and give every task what it consumes and what it produces, so parallel tasks agree on names without talking, and tell the reviewer where to look.
---

# Interfaces between tasks

Tasks that run side by side cannot ask each other anything. Two implementers who each invent the name of the same
function produce code that does not fit. Decide the names in the plan.

## The Program Design already holds the names

The Software Architect wrote `program-design.md` and the user approves it with the plan: code that differs from it is
a Deviation. So the names are not yours to invent; they are yours to hand out.

- Its `## File tree` lists each file the Change adds (`+`), changes (`~`) or removes (`-`). Give every line to the
  task that builds it, inside that task's `touches`. A line no task owns is work nobody does.
- Its `## Signatures and contracts` are the `Produces` lines: copy each signature into the task that writes its file,
  spelled exactly as there. A `Consumes` line quotes the same signature with the producing task's id.
- A name the tasks need that the Program Design lacks is a gap in it, not a choice for you: stop and report it, so the
  Architect adds it before the gate.
- Where it shows a call tree or a dependency map, follow it for `depends_on`: a caller depends on what it calls only
  when it imports it.

## For every task, write

In the task's `notes` (the implementer reads them in its brief):

```
Produces:
  - lib/booking/slots.ts: listFreeSlots(practitionerId: string, day: string): Promise<Slot[]>
  - type Slot = { id: string; startsAt: string; endsAt: string }   (in lib/booking/types.ts)
  - POST /api/bookings  { slotId } -> 201 { id } | 409 { type: "slot-taken" }
Consumes:
  - T02: getSession(): Promise<Session | null>   (lib/auth/session.ts)
Review focus:
  - two requests for the same slot: exactly one succeeds
```

- **Produces**: every name another task will import or call: the file, the exported name, the signature, the
  route with its request and response, the table and columns, the event and its payload. Exact spelling.
- **Consumes**: what this task uses from another, with that task's id. Each entry must match a `Produces` line
  of the named task word for word, and that task must be in `depends_on` unless both only agree on a type. Copy the
  whole line, then put the task id in front: keep every part of it, the file in brackets and any note after the
  shape (`(sorted by startsAt; [] when ...)`) included. Do not shorten, reorder or reword it; a Consumes line that
  drops a note is a different contract.
- **Review focus**: the one to three places where this task is most likely to be wrong. It goes to the reviewer.
  One concern per point: a point that joins two concerns with "and", a semicolon or a comma is two points, and
  more than three points means you keep the three that matter most.

## Rules

- A name appears in exactly one task's `Produces`. Two tasks that would both produce it means one more task
  (the shared type or module) that both depend on, or one task that is too small to split.
- Shared types that several tasks need are produced by the earliest of them, or by the scaffold task, never by
  "whoever gets there first".
- When a `Consumes` line would be the only reason for a dependency, prefer agreeing on the shape here and letting
  the tasks run in parallel: the plan is the contract.
- Do not write the implementation. A signature and a shape are the interface; the body is the implementer's.
- If you cannot write a task's `Produces`, the task is not understood well enough to hand over. Go back to the
  requirement.

## Check before you finish

- every line of the Program Design's file tree is in some task's `touches`, and every signature in one task's `Produces`;
- every `Consumes` line is its `Produces` line copied whole (compare them character by character), and nothing is produced twice;
- every `Review focus` has at most three points, each one concern;
- every scenario is covered by a task whose `Produces` could make it pass;
- a task with a `Review focus` on money, access or data loss is `risk: high`.

## Sources

Ideas, not wording: the exact-names-and-paths discipline of obra/superpowers `writing-plans`, the slicing guidance
of BMAD-METHOD, consumer-driven contracts, and humanlayer's rpi plugin (`create-tdd`: a Program Design with file-tree changes and
signatures, and Patterns to Follow with source paths; `create-structure-outline`: the outline is cut from that design,
with manual checks kept apart from automated ones). Matt Pocock's `to-tickets` stays the base for cutting tasks.
