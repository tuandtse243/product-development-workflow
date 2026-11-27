import { createApp } from "../src/app.ts";
import { createSession, hashPassword } from "../src/auth/sessions.ts";
import { createDb, type Db } from "../src/db/client.ts";
import { memoryMailer } from "../src/mail/mailer.ts";
import { http } from "./http.ts";

/**
 * One in-memory Postgres per test file: starting PGlite is slow (seconds under load), so it starts once and every
 * testApp() empties it. Tests in a file run one after another, so each test still starts from an empty database.
 */
let shared: Promise<Db> | null = null;

/**
 * A fresh app on an emptied database, with helpers to seed rows and sign in. `http()` sends requests to the app
 * in-process (tests/http.ts): no port, no socket. Each test builds its own and closes it, so tests never share data.
 */
export async function testApp() {
  shared ??= createDb();
  const db: Db = await shared;
  // Every table of the schema, whatever a later migration adds.
  const tables = await db.query<{ name: string }>("select quote_ident(tablename) as name from pg_tables where schemaname = 'public'");
  if (tables.length) await db.query(`truncate table ${tables.map((t) => t.name).join(", ")} restart identity cascade`);
  const mailer = memoryMailer();
  const app = createApp({ db, mailer });
  const client = http(app);
  let n = 0;

  const seed = {
    async user(name = `user${++n}`): Promise<{ id: string; email: string; token: string }> {
      const email = `${name}-${n}@example.test`;
      const [u] = await db.query<{ id: string }>("insert into users (email, name, password_hash) values ($1, $2, $3) returning id", [email, name, hashPassword("pw")]);
      const token = await createSession(db, u!.id, 1);
      return { id: u!.id, email, token };
    },
    async team(name = `team${++n}`, members: { id: string }[] = []): Promise<{ id: string }> {
      const [t] = await db.query<{ id: string }>("insert into teams (name) values ($1) returning id", [name]);
      for (const m of members) await db.query("insert into team_members (team_id, user_id) values ($1, $2)", [t!.id, m.id]);
      return { id: t!.id };
    },
    async project(teamId: string, name = `project${++n}`): Promise<{ id: string; teamId: string }> {
      const [p] = await db.query<{ id: string }>("insert into projects (team_id, name) values ($1, $2) returning id", [teamId, name]);
      return { id: p!.id, teamId };
    },
  };

  /** `Authorization` header of a signed-in user. */
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

  return {
    app,
    db,
    mailer,
    seed,
    auth,
    /** supertest-style: `await t.http().post(url).set(name, value).send(body)` gives `{ status, headers, body, text }`. */
    http: () => client,
    /** Ends any request still being served; the database stays for the next test of the file. */
    close: async () => client.close(),
  };
}

export type TestApp = Awaited<ReturnType<typeof testApp>>;
