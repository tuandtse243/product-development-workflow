---
case: accepts-a-warning-with-its-reason
---
## Input

Approved requirements for a booking app that already exists: editing a booking, cancelling a booking, listing bookings, a booking
summary email, and an end-to-end flow. The architecture adds a database trigger `booking_conflict` that rejects overlapping
bookings with a 409. The `## Plan` section of `analysis.md` already says: "T03 (edit booking) needs T01's trigger because its
409 scenarios only pass once the trigger exists; T03 carries 14 of 30 scenarios because every edit scenario goes through one
function, `editBooking`, which cannot be cut without two tasks editing the same file." T01 touches `db/triggers/**`, T03 touches
`lib/booking/edit.ts` and `app/booking/[id]/**`: they share no files. Plan the tasks and write `tasks.yaml`.

## Criteria

- must write on T03 an `accept:` entry with `warn: depends-without-overlap` and `on: T01`, with a `why` that names the trigger or the 409 scenarios
- must write an `accept:` entry with `warn: large-task` on T03 whose `why` names `editBooking` (every edit scenario goes through one function)
- must give every `accept` entry a concrete `why` taken from the stated reasons in the plan, not a general phrase such as "needed" or "intended"
- must not add an `accept:` entry for a warning that does not occur: no entry for `catch-all-touches` (no task touches `**`) and none for `one-chain` or `narrow-plan` (the plan has parallel slices)
- must still keep `depends_on` only for real dependencies, and must not use `accept` to keep a dependency whose reason the plan does not state
