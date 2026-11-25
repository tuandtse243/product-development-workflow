import request from "supertest";
import { createApp } from "../src/app.ts";
import { createSession, hashPassword } from "../src/auth/sessions.ts";
import { createDb, type Db } from "../src/db/client.ts";
import { memoryMailer } from "../src/mail/mailer.ts";

/**
 * A fresh app on its own in-memory Postgres, with helpers to seed rows and sign in. Each test builds its own, so tests
 * never share data.
 */
export async function testApp() {
  const db: Db = await createDb();
  const mailer = memoryMailer();
  const app = createApp({ db, mailer });
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

  return { app, db, mailer, seed, auth, http: () => request(app), close: () => db.close() };
}

export type TestApp = Awaited<ReturnType<typeof testApp>>;
