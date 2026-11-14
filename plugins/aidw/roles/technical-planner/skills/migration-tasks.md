# Planning a migration

A task that adds or changes a database migration is `risk: high` (it runs alone; `aidw analyze` warns otherwise)
and follows the migration rule in `aidw plugin-path roles/qa/references/quality-layers.md` (section "Database migrations"):
reversible, tested against a seeded database, additive first (expand-contract, never a rename or drop in one
step). A migration is always its own task, owned by the Role that writes it (`fullstack` or `backend` today), and
the tasks that use the new shape `depends_on` it.
