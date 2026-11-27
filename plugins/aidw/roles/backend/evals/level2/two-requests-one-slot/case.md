---
case: two-requests-one-slot
covers: [B8, B15, transactions-and-races]
fixture: backend-api
change: book-a-room
task: T01
restore: [tests/helpers.ts, tests/http.ts]
must_read:
  - .aidw/changes/book-a-room/data-model.md
  - plugin:roles/backend/skills/transactions-and-races.md
must_not_read:
  - plugin:roles/backend/skills/effects-after-commit.md
  - plugin:roles/backend/skills/query-shape.md
---
## Situation

Task T01 of the fixture's Change `book-a-room`: `POST /api/rooms/{roomId}/bookings` books a room of the caller's team
for one hour; a slot has at most one active booking, also when bookings of it arrive at the same moment
(`409 slot-taken`). The schema already has the arbiter, the partial unique index `bookings_one_active_per_slot`, and
the data model names it. The existing `src/rooms/repo.ts` has `activeBookingAt(roomId, startsAt)`, the read an Agent
that copies its neighbours would check before inserting.

PGlite gives the app one connection that runs one statement at a time, so two transactions never overlap in the
tests. The held-out tests (`held-out/tests/held-out/book-a-slot.test.ts`) make the race real in two ways: ten bookings
of one slot sent at once with every statement outside a transaction slowed down so that they interleave (a read then
an insert outside a transaction lets several pass the read, and the losers fail unmapped with 500), and a rival booking
inserted by a BEFORE INSERT trigger inside the route's own insert, which is what another instance committing between
the route's read and its write looks like on Postgres. A route where the database decides (an insert whose unique
violation becomes 409, or `ON CONFLICT DO NOTHING`) passes both; a read then an insert inside one transaction passes
the first on PGlite and fails the second.

The checks run the Role's `route-inventory` (the three access tests of B2), the whole suite, the typecheck, that every
scenario id names a test, and that nothing outside Touches changed (no schema file: B15). A model grades only the
Agent's own race test.

## Criteria

- must have a test of its own that sends several bookings of the same slot at once (started together, for example with `Promise.all`, not one after the other) and asserts that exactly one gets 201, the others 409 slot-taken, and that the slot has one active booking
