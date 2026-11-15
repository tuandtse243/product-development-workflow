# Indexes, constraints, seeds and fixtures

## Indexes and constraints

- Add an index for a query a scenario or the architecture names (a `where` or `order by` on a growing table), not for every
  column. Say in your report which query it serves.
- A business rule that must always hold is a constraint in the database (unique, not null, check, foreign key), not only a
  check in the code. A unique constraint states the rule's real scope (for example one active booking per slot, a partial
  unique index on the active rows).
- Name constraints and indexes explicitly so that the down migration can drop them by name.
- Test the constraint: insert a row that violates it and assert the database refuses.

## Seeds and test fixtures

- A **dev seed** is deterministic and idempotent (safe to run twice), and contains no real personal data or secrets.
- A **test fixture** is built by the test that needs it, small, with ids written in the test so that the assertion is readable.
  A migration test seeds the rows it needs *before* applying the migration, so it proves existing data survives.
- Never put production data in a seed or a fixture.
