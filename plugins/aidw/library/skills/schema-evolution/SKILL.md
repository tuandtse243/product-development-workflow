---
name: schema-evolution
description: Change a schema that already holds data without breaking running code or locking a busy table - an expand, migrate, contract plan the planner turns into tasks.
---

# Evolving a live schema

Old code and new code run at the same time during a deploy, and a table with rows cannot be rebuilt for free. So
a change that is one statement on an empty database is several steps on a live one.

## The shape of every change: expand, migrate, contract

1. **Expand**: add the new thing beside the old (a nullable column, a new table, a new index). Old code still works.
2. **Migrate**: the code writes both, or the new one; a backfill copies old data in batches; the code then reads
   the new one.
3. **Contract**: remove the old thing, in a later task, once nothing reads or writes it.

Each step is its own task, in order, and the contract step is often its own Change. Never rename or drop in the
step that adds.

| You want to | Do this |
|---|---|
| rename a column | add the new column, write both, backfill, read the new one, drop the old one later |
| change a type | add a column of the new type and migrate, unless the change needs no rewrite (below) |
| make a column required | add it nullable, backfill, then add the constraint the cheap way (below) |
| split or merge a table | create the new shape, write both, backfill, switch reads, drop later |
| drop a column | stop reading it, stop writing it, then drop |

## PostgreSQL: what each statement costs

Checked against the PostgreSQL 18 documentation. `ALTER TABLE` takes an `ACCESS EXCLUSIVE` lock unless noted: it
blocks reads and writes while it runs, and while it waits it blocks everyone queued behind it.

| Statement | Cost |
|---|---|
| `ADD COLUMN` with no default, or a constant default | no rewrite; fast |
| `ADD COLUMN` with a volatile default, an identity or a stored generated column | rewrites the table and its indexes |
| `DROP COLUMN` | no rewrite (the column becomes invisible); fast |
| `ALTER COLUMN ... TYPE` | normally rewrites the table and indexes; no rewrite when the old type is binary coercible to the new (`varchar` to `text`) |
| `SET NOT NULL` | scans the whole table under the lock, unless a valid `CHECK (col IS NOT NULL)` already proves it |
| `ADD FOREIGN KEY` | `SHARE ROW EXCLUSIVE` on both tables, and scans; add it `NOT VALID` first |
| `ADD CONSTRAINT ... NOT VALID` | no scan; commits at once |
| `VALIDATE CONSTRAINT` | `SHARE UPDATE EXCLUSIVE`: reads and writes continue |
| `CREATE INDEX` | blocks writes (not reads) until done |
| `CREATE INDEX CONCURRENTLY` | does not block writes; cannot run in a transaction; a failed build leaves an `INVALID` index to drop or `REINDEX INDEX CONCURRENTLY` |
| unique or primary key | build the index `CONCURRENTLY`, then `ADD CONSTRAINT ... USING INDEX` |

So, on a table with rows:

- **Required column**: add nullable; backfill in batches; `ADD CONSTRAINT ... CHECK (col IS NOT NULL) NOT VALID`;
  `VALIDATE CONSTRAINT`; `SET NOT NULL` (now without a scan); drop the check.
- **Foreign key**: `ADD CONSTRAINT ... FOREIGN KEY ... NOT VALID`, then `VALIDATE CONSTRAINT`.
- **Index**: `CONCURRENTLY`, in its own migration outside a transaction.
- **Every migration sets `lock_timeout`** (a few seconds) and is safe to retry, so a blocked statement fails
  instead of queueing the whole application behind it.
- **Backfill in batches** by primary key range, each batch its own transaction, restartable.

`squawk` flags most of these; a migration that it flags is fixed, not excused.

## Documents (MongoDB)

There is no `ALTER TABLE`: old and new shapes coexist. Add a `schemaVersion` field, make the code read both
versions, write the new one, and migrate documents lazily on write or with a batched background job. Tighten the
validator only after the backfill. Build an index before the code that needs it ships.

## What the plan contains (`data-model.md`, section "Evolution")

For each change to something that has data: the steps in order, which task each is, what old and new code each
see between steps, the backfill (size, batching, how to resume), how to go back from each step, and the point
after which going back loses data. That point is named at the Approval Gate.

## Sources

Ideas, not wording: the PostgreSQL 18 documentation for `ALTER TABLE` and `CREATE INDEX` (every cost above was
read there); xataio/pgroll and the expand-and-contract pattern; the Squawk rule set; timescale/pg-aiguide;
MongoDB's schema-versioning pattern.
