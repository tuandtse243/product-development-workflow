# Migrations with Drizzle

- The schema is TypeScript (`src/db/schema.ts` or as the project configures it); `drizzle.config.ts` names the dialect, the
  schema and the output folder (`drizzle/`).
- `pnpm exec drizzle-kit generate` writes a numbered SQL migration into the output folder from the schema change; read the SQL it
  produced before you keep it (a rename can come out as drop and add: edit it, or split the change).
- `pnpm exec drizzle-kit migrate` applies migrations. **`drizzle-kit push` syncs the schema without a migration file: it is for
  prototyping, never for a task of this Role**, because nothing records the change and there is nothing to reverse.
- **Drizzle has no down migrations.** Write the reverse by hand as a SQL file next to the migration (for example
  `drizzle/<number>_<name>.down.sql`) and apply it in the test through the same connection the test already uses.
- To test: a fresh local database (SQLite file or Docker Postgres), apply the migrations in order, load the seed, run your
  up/check, apply the down file, check the old shape.
- Do not edit a migration that has been applied anywhere; add a new one.
