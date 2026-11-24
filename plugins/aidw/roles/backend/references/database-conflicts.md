# Transactions, locks and the errors a conflict raises

Lookup material for the backend Role, read when a task writes more than one row, guards a rule under concurrent
requests, or must map a database refusal to the contract. How to choose the guard is the procedure of the backend
Skill on transactions and races; this file is the reference it leans on. A constraint or an index that does not exist
yet is a `database` task: ask `database-architect` (a Consultation), and report it under Owed if nothing is planned.

## Isolation levels

| Database | Default | What the default still lets happen |
|---|---|---|
| PostgreSQL | Read Committed | each statement sees what was committed before it started; two transactions can both read "1 seat left" and both write |
| MySQL (InnoDB) | Repeatable Read | plain `SELECT` reads a snapshot taken at the first read; a locking read (`FOR UPDATE`) reads the latest committed row and takes next-key (gap) locks |
| SQLite | Serializable | one writer at a time for the whole file; a second writer gets `SQLITE_BUSY` |

PostgreSQL in more detail:

- **Repeatable Read** is snapshot isolation: no non-repeatable reads, no phantoms, but write skew is possible (two
  transactions each check a different row and both commit). Updating a row another transaction changed fails with
  `40001`.
- **Serializable** adds detection of the remaining anomalies and fails one transaction with `40001`. Every
  transaction at this level must be ready to be retried as a whole.
- Raising the isolation level is rarely the first answer in a web request. A constraint or a conditional update is
  cheaper and states the rule in one place.

## Guards, from cheapest

| Guard | Shape | Use when |
|---|---|---|
| Unique or partial unique constraint | `UNIQUE (slot_id) WHERE status = 'booked'` | "at most one" of something |
| Check constraint | `CHECK (stock >= 0)` | "cannot go below zero" on one row |
| Conditional update | `UPDATE stock SET qty = qty - $1 WHERE id = $2 AND qty >= $1`, then test the affected row count | read-then-write on one row |
| Insert or skip | `INSERT ... ON CONFLICT DO NOTHING` (PostgreSQL, SQLite), `INSERT IGNORE` or `ON DUPLICATE KEY UPDATE` (MySQL) | create once, idempotent handlers |
| Version column (optimistic) | `UPDATE ... SET version = version + 1 WHERE id = $1 AND version = $2` | edits by people, with `If-Match` |
| Row lock (pessimistic) | `SELECT ... FOR UPDATE` inside the transaction | several rows must be checked together; keep the transaction short |
| Queue claim | `SELECT ... FOR UPDATE SKIP LOCKED LIMIT n` | workers taking jobs from a table |
| Advisory lock | `pg_advisory_xact_lock(key)` (PostgreSQL) | a rule that spans rows no constraint can express |

`NOWAIT` makes a lock fail at once instead of waiting; `lock_timeout` and `statement_timeout` (PostgreSQL) bound the
wait. On SQLite start a write transaction with `BEGIN IMMEDIATE` and set a busy timeout, so two readers do not both try
to upgrade to writers.

No network call while a transaction is open: it holds locks for as long as the outside service takes.

## Error codes and what they mean for the response

| Meaning | PostgreSQL (SQLSTATE) | MySQL (error number) | SQLite (extended code) | Usual response |
|---|---|---|---|---|
| Unique violation | `23505` `unique_violation` | `1062` `ER_DUP_ENTRY` | `SQLITE_CONSTRAINT_UNIQUE`, `SQLITE_CONSTRAINT_PRIMARYKEY` | `409`, or replay for an idempotent create |
| Foreign key violation | `23503` | `1452` (child row), `1451` (parent row) | `SQLITE_CONSTRAINT_FOREIGNKEY` | `422` or `404` for a reference the client sent; `409` when deleting a parent still in use |
| Not null violation | `23502` | `1048` | `SQLITE_CONSTRAINT_NOTNULL` | a bug: validation should have refused it first (`500`, fix the schema) |
| Check violation | `23514` | `3819` (MySQL 8.0.16 and later) | `SQLITE_CONSTRAINT_CHECK` | `409` or `422`, as the contract names the rule |
| Serialization failure | `40001` | - | - | retry the whole transaction, bounded |
| Deadlock | `40P01` | `1213` (transaction rolled back) | - | retry the whole transaction, bounded |
| Lock not available or lock wait timeout | `55P03` | `1205` (by default only the statement is rolled back); `3572` `ER_LOCK_NOWAIT` for `NOWAIT` | `SQLITE_BUSY` | retry, or `409` when `NOWAIT` was the design |
| Statement timeout | `57014` | `3024` (`MAX_EXECUTION_TIME` exceeded) | - | `503` or `500`; look at the query |

Map by code, never by message text, and in one place (the repository or the error mapper), so the rest of the code
sees the application's own error (`SlotTaken`) and not the driver's. A retry after `40001`, `40P01` or `1213` reruns
the whole transaction from its first statement, at most a few times; when it still fails the answer is `503` with
`Retry-After`, or `409` only if the contract uses it for concurrency conflicts (AIP-193 maps ABORTED to `409`); not
`500`. ORMs wrap these codes: Prisma reports a unique violation as `P2002`, a missing record for an update as `P2025`,
a write conflict or deadlock as `P2034` (retry the transaction); check the project's ORM documentation for the rest.

## Sources

PostgreSQL 18 documentation: "Transaction Isolation", "Explicit Locking", `SELECT` (the locking clause), `INSERT` (`ON
CONFLICT`), Appendix A "PostgreSQL Error Codes". MySQL 8.4 Reference Manual: "Transaction Isolation Levels", "Locking
Reads", "Server Error Message Reference". SQLite documentation: "Result and Error Codes", "Transaction" (`BEGIN
IMMEDIATE`), "Isolation in SQLite". Google AIP-193. Prisma error reference. Written for aidw; no text copied.
