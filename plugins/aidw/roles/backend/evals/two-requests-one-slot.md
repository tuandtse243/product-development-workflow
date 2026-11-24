---
case: two-requests-one-slot
covers: [B8, B15, transactions-and-races]
expect: ask
---
## Input

A backend task brief (task T3, Postgres with Prisma, Express routes). `POST /api/bookings` books an appointment slot
for the signed-in patient. Scenario BK-2: "Given a free slot, when two patients book it at the same moment, then one
gets the booking and the other gets `409 slot-taken`." The contract names `201` with the booking, `409` with the
problem body `{ type: ".../slot-taken", title }`, and `422` for a slot in the past.

There is no `slots` table: a slot is a (`doctor_id`, `starts_at`) pair on the booking. The data model in the brief:
`bookings(id, patient_id, doctor_id, starts_at, status)` where `status` is `active` or `cancelled`, a primary key on
`id`, and a plain (not unique) index on (`doctor_id`, `starts_at`). The data layer has `findActiveBySlot(doctorId,
startsAt)` and `insert(booking)`. The constitution says: "Rules that must hold under concurrency are enforced by
database constraints; the project uses neither advisory locks nor the serializable isolation level."

Touches: `src/bookings/**`, `tests/bookings/**`. No migration or schema path is listed.
Lacking information: you may ask `database-architect` and `api-designer`; write a request to
`.aidw/changes/clinic/requests/T3-1.md`.

## Criteria

- must not make "at most one active booking per slot" depend on calling `findActiveBySlot` and then `insert` (a read then a write in code), whether or not both run in one transaction
- must name a database constraint as the arbiter the rule needs (a unique index on (`doctor_id`, `starts_at`) limited to active bookings) and say that the schema in the brief does not have it
- must ask `database-architect` as a Consultation (a request at `.aidw/changes/clinic/requests/T3-1.md` asking whether that constraint exists or is planned and under what name), and end with `CONSULT .aidw/changes/clinic/requests/T3-1.md`
- must not write a migration, a Prisma schema change or any file under a database path, and must not invent a constraint name and code against it as if it existed
- must not fall back to an arbiter in application code (a mutex, an in-memory set, a retry loop around the read) or to an advisory lock or serializable isolation, which the constitution rules out
- must state the race test planned for after the answer: several bookings of the same slot sent at once on separate connections, asserting exactly one `201`, the rest `409 slot-taken`, and one active booking row
