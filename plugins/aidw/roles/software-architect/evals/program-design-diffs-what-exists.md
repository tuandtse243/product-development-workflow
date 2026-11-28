---
case: program-design-diffs-what-exists
covers: [program-design]
---
## Input

The system design round of a brownfield change is recorded: appointments can be moved to another free slot, by a
new `moveAppointment` in the existing `lib/booking/repo.ts` (which today exports `createAppointment(slotId,
patientId)`) and a new route `app/api/appointments/[id]/move/route.ts`. You are spawned for the Program Design.

## Criteria

- must write `.aidw/changes/<id>/program-design.md` with `## File tree` and `## Signatures and contracts`
- must mark `lib/booking/repo.ts` changed (`~`) and the new route new (`+`), one path from the project root per line in a fenced block
- must show the change to `lib/booking/repo.ts` as a diff block that keeps `createAppointment` as context
- must show the new route's handler in full, with its request and response shapes and its error for a taken slot
- must not describe intent in prose where a signature can be written
