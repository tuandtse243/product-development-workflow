import { createApp } from "../app.ts";
import { createSession } from "../auth/sessions.ts";
import { createDb, type Db } from "../db/client.ts";
import type { TeamRole } from "../teams/repo.ts";
import { http } from "./http.ts";

/**
 * One in-memory Postgres per test file: starting PGlite is slow (seconds under load), so it starts once and every
 * testApp() empties it. Tests in a file run one after another, so each test still starts from an empty database.
 */
let shared: Promise<Db> | null = null;

export interface Seeded {
  id: string;
  email: string;
  token: string;
}

/**
 * A fresh app on an emptied database, with helpers to seed rows and sign in. `http()` sends requests to the app
 * in-process (tests/http.ts): no port, no socket. The web tests use it too (web/tests/backend.ts).
 */
export async function testApp() {
  shared ??= createDb();
  const db: Db = await shared;
  // Every table of the schema, whatever a later migration adds.
  const tables = await db.query<{ name: string }>("select quote_ident(tablename) as name from pg_tables where schemaname = 'public'");
  if (tables.length) await db.query(`truncate table ${tables.map((t) => t.name).join(", ")} restart identity cascade`);
  const app = createApp({ db });
  const client = http(app);
  let n = 0;

  const seed = {
    async user(name = `user${++n}`): Promise<Seeded> {
      const email = `${name}-${n}@example.test`;
      const [u] = await db.query<{ id: string }>("insert into users (email, name) values ($1, $2) returning id", [email, name]);
      const token = await createSession(db, u!.id, 1);
      return { id: u!.id, email, token };
    },
    /** A team, with the given users as its owners and members. */
    async team(name = `team${++n}`, who: { owners?: { id: string }[]; members?: { id: string }[] } = {}): Promise<{ id: string }> {
      const [t] = await db.query<{ id: string }>("insert into teams (name) values ($1) returning id", [name]);
      const add = async (users: { id: string }[] | undefined, role: TeamRole) => {
        for (const u of users ?? []) await db.query("insert into team_members (team_id, user_id, role) values ($1, $2, $3)", [t!.id, u.id, role]);
      };
      await add(who.owners, "owner");
      await add(who.members, "member");
      return { id: t!.id };
    },
    async project(teamId: string, name = `project${++n}`): Promise<{ id: string; teamId: string; name: string }> {
      const [p] = await db.query<{ id: string }>("insert into projects (team_id, name) values ($1, $2) returning id", [teamId, name]);
      return { id: p!.id, teamId, name };
    },
  };

  /** The `Cookie` header of a signed-in user. */
  const as = (u: { token: string }) => ({ Cookie: `sid=${u.token}` });

  return {
    app,
    db,
    seed,
    as,
    /** supertest-style: `await t.http().patch(url).set(name, value).send(body)` gives `{ status, headers, body, text }`. */
    http: () => client,
    /** Ends any request still being served; the database stays for the next test of the file. */
    close: async () => client.close(),
  };
}

export type TestApp = Awaited<ReturnType<typeof testApp>>;
