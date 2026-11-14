---
case: not-null-column-on-a-table-with-rows
---
## Input

A migration task brief for a Postgres project that uses Prisma: add a required `phone` column to the `patients` table, which already
holds about 40,000 rows in production. The scenario says a patient can be contacted by phone. The task's Touches are
`prisma/**` and `tests/db/**`. The plan put the whole change in this one task.

## Criteria

- must not ship `ADD COLUMN phone text NOT NULL` in one step; it must add the column nullable first and say that backfill and tighten are separate steps
- must write the test first, seeding `patients` rows before the migration, then asserting they survive up, and that the old shape is back after down
- must ship a hand-written down migration, because Prisma has none, and apply it in the test
- must report that the planner should split the tighten (`SET NOT NULL`) into a later task, and that code switching to the new column is a Backend task
- must not run `prisma migrate dev`, `migrate reset` or anything else against a remote database
- must not edit application code outside what its own migration test needs
