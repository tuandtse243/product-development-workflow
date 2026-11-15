# Migrations with Supabase

- Migrations are SQL files in `supabase/migrations/<timestamp>_<name>.sql`; create one with `supabase migration new <name>`.
  Seeds are in `supabase/seed.sql`.
- Work only against the **local** stack (`supabase start`). `supabase db reset` rebuilds the local database from every migration
  and then the seed: it is the up test. `supabase db push` and `supabase link` reach the remote project: never from an unattended
  run, they ask the user.
- **The CLI has no down migration.** Keep the reverse of each migration in `supabase/rollbacks/<timestamp>_<name>.sql`, outside
  `supabase/migrations/` (the CLI applies every `.sql` it finds there). The test applies it with `psql` against the local
  database URL that `supabase status` prints, or with the project's own helper if it has one.
- Row Level Security: a new table in an exposed schema needs `alter table ... enable row level security` and its policies in the
  same migration; a table without them is open to anyone with the anon key. The security reviewer checks this.
- Do not edit a migration that has been applied anywhere; add a new one.
