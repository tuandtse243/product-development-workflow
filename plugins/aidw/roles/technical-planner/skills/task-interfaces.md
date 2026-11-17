---
name: task-interfaces
description: Give every task what it consumes and what it produces, so parallel tasks agree on names without talking, and tell the reviewer where to look.
---

# Interfaces between tasks

Tasks that run side by side cannot ask each other anything. Two implementers who each invent the name of the same
function produce code that does not fit. Decide the names in the plan.

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
  of the named task word for word, and that task must be in `depends_on` unless both only agree on a type.
- **Review focus**: the one to three places where this task is most likely to be wrong. It goes to the reviewer.

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

- every `Consumes` has a matching `Produces`, and nothing is produced twice;
- every scenario is covered by a task whose `Produces` could make it pass;
- a task with a `Review focus` on money, access or data loss is `risk: high`.

## Sources

Ideas, not wording: the exact-names-and-paths discipline of obra/superpowers `writing-plans`, the slicing guidance
of BMAD-METHOD, and consumer-driven contracts. Matt Pocock's `to-tickets` stays the base for cutting tasks.
