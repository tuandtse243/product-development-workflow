# Migrations with Prisma

- The schema is `prisma/schema.prisma`; a migration is a folder `prisma/migrations/<timestamp>_<name>/migration.sql`.
- Create it locally with `pnpm exec prisma migrate dev --name <name>`. It needs a database and creates a shadow database, so run
  it only against the **local** one (`DATABASE_URL` points at localhost or a SQLite file). Set `DATABASE_URL` to the local database in the same command (`DATABASE_URL=file:./test.db pnpm exec prisma ...`), so a stale
  `.env` can never point it elsewhere; `migrate reset --force` only ever runs that way. Never run `migrate dev` or
  `migrate reset` against a remote database; production and CI use `prisma migrate deploy`, which only applies what exists.
- **Prisma has no down migrations.** Write the reverse by hand as `prisma/migrations/<timestamp>_<name>/down.sql` (it sits
  beside the migration; Prisma ignores it). `prisma migrate diff --from-schema <new schema> --to-schema <old schema> --script` (Prisma 7 flag names; Prisma 6 and lower
  spell them `--from-schema-datamodel` and `--to-schema-datamodel`)
  prints a starting point for the reverse; read it before you keep it.
- To test: start from a fresh local database, `prisma migrate deploy`, load the seed, run your up/check, apply `down.sql` with
  `prisma db execute --file <down.sql> --schema prisma/schema.prisma`, and check the old shape. After a down, the migration
  history table still lists the migration; the test resets the database instead of continuing from it.
- Seeds: the `prisma.seed` command in `package.json`, run by `prisma db seed` and after `migrate reset`. Keep it idempotent.
- Before you report: `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code`
  must exit 0 (exit 2 means the schema has a change that no migration carries). On Postgres also run
  `squawk prisma/migrations/<new folder>/migration.sql` when squawk is installed and fix what it reports.
- Do not edit a migration that has been applied anywhere; add a new one.
