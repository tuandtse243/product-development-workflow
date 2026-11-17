---
name: schema-design-postgres
description: Design the data model of a Change for PostgreSQL - from the queries the scenarios imply to tables, keys, constraints and indexes - and write it as data-model.dbml and data-model.md.
---

# Schema design for PostgreSQL

Design from how the data is read and written, not from the nouns in the requirements. The rule book for details
(types, indexes, row-level security, locks) is the vendored
`aidw vendor-path supabase/supabase-postgres-best-practices`; read its notes in `library/vendored-skill-notes.md`
first, and open a reference file only when a decision needs it.

## 1. Access paths first

From the scenarios, list every read and write the Change needs, before drawing a table:

| # | Scenario id | Read or write | By what (filter, sort, limit) | How often, how many rows | Must be consistent with |
|---|---|---|---|---|---|

This table decides the indexes, the unique constraints and where a transaction is needed. A table or column that
no access path uses is not in the design.

## 2. Tables

- One table per thing with its own identity and lifecycle. Normalise to third normal form first; denormalise only
  for a listed access path, and write down who keeps the copy correct.
- **Keys.** A surrogate primary key (`bigint generated always as identity`, or a UUIDv7 when ids are created
  outside the database or shown to users), plus a unique constraint on the natural key that the business treats
  as unique. Never a random UUIDv4 as the clustered insert key of a large table.
- **Types.** `text` (with a check on length where the business has a limit), `timestamptz` for instants, `date`
  for calendar days, `numeric` for money (or an integer in the minor unit), `boolean`, `jsonb` only for data whose
  shape truly varies and is not filtered on by many keys. An enumeration that will grow is a lookup table or a
  check, not a native enum.
- **Constraints carry the business rules.** `NOT NULL` unless absence means something, foreign keys with an
  explicit `ON DELETE`, `CHECK` for ranges and state combinations, a unique or exclusion constraint for "at most
  one" and "no overlap". A rule the database can enforce is not left to the application alone.
- **Many-to-many** is a join table with its own composite primary key and any facts about the link.
- **Soft delete** (`deleted_at`) only when the requirements need undelete or history: then unique constraints
  become partial indexes (`WHERE deleted_at IS NULL`) and every read path says whether it sees deleted rows.
- **Multi-tenancy**: the tenant key on every tenant-owned table, first in its indexes, and in foreign keys.

## 3. Indexes

One per access path that needs it, no more: the primary key and unique constraints already are indexes. Index
every foreign key column that is filtered or joined on. Composite order: equality columns, then the range or sort
column. A partial index when the path always filters on a constant. Say which path each index serves.

## 4. Concurrency and lifecycle

For each write path that could race (book the last slot, spend a balance): the constraint or the lock that makes
it safe. For each table: how rows are archived or deleted, and what the law or the contract requires be kept.

## 5. Output

- `changes/<id>/data-model.dbml`: the source of truth. Tables, columns with type and `[pk, not null, unique,
  default, note]`, `Ref` lines with the delete rule, `indexes { }` blocks, and a `Note` per table with its rules.
- `changes/<id>/data-model.md`: the access-path table, the decisions a reader would question (with the reason and
  what was rejected), the constraints that carry business rules, and one Mermaid `erDiagram` at entity level
  (names and relationships only).
- For a schema that already has data, follow `aidw vendor-path aidw/schema-evolution` and add its plan.

## Sources

Ideas, not wording: the PostgreSQL documentation (data types, constraints, indexes); Supabase's Postgres best
practices and timescale/pg-aiguide (design from queries; type choices); Markus Winand's *Use The Index, Luke*;
DBML (dbml.dbdiagram.io) for the format.
