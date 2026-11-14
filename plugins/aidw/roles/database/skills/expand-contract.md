# Expand, backfill, contract

Anything live or already holding rows is changed in steps that can each be shipped and reversed. Never a rename, a drop or a
new required column in one step.

1. **Expand** (this Role, a migration task): add the new thing beside the old one. A new column is **nullable** (or has a
   constant default the database can add cheaply); a new table is added empty; a new index is added. Nothing the running
   code depends on changes.
2. **Backfill** (a data step, this Role): fill the new column from the old data in **batches**, idempotently (it can run twice
   and resume), with the migration's own test proving the counts: rows backfilled equals rows that needed it. A large table is
   never updated in one statement.
3. **Switch** (Backend and Frontend tasks, not yours): the code writes both, then reads the new one. Say in your report that
   this step is needed.
4. **Contract** (a later migration task): after the data is verified, tighten: `SET NOT NULL` once no NULL remains, add the
   foreign key or unique constraint, then drop the old column or table.

## Checks for a "NOT NULL column on a table with rows"

- The expand step adds the column nullable and the test seeds rows first: they survive, and the column is NULL for them.
- The backfill gives every existing row a value; the test asserts `count(*) where col is null` is 0 before the tighten.
- The tighten is its own task; if the planner put expand and tighten in one task, report that, because a failure in the
  tighten would block the whole task and cannot be rolled back after a partial backfill.
- Adding a unique constraint or an index on a large table can lock it: when the tool allows, create the index in a way that does
  not block writes (Postgres: `create index concurrently`, which cannot run inside a transaction, so check whether the migration
  tool wraps the file in one). If you cannot be sure it is safe at the table's size, stop and report.

## When it cannot be reversed

A drop of data or a lossy type change cannot be undone by a down migration. Do not ship it quietly: report it, so that the
Analysis states why it cannot be undone and the user accepts it at the gate.
