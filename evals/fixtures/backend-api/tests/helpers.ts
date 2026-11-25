import type { AddressInfo } from "node:net";
import request from "supertest";
import { createApp } from "../src/app.ts";
import { createSession, hashPassword } from "../src/auth/sessions.ts";
import { createDb, type Db } from "../src/db/client.ts";
import { memoryMailer } from "../src/mail/mailer.ts";

/**
 * One in-memory Postgres per test file: starting PGlite is slow (seconds under load), so it starts once and every
 * testApp() empties it. Tests in a file run one after another, so each test still starts from an empty database.
 */
let shared: Promise<Db> | null = null;
const TABLES = "outbox, tasks, projects, team_members, teams, sessions, users";

/**
 * A fresh app on an emptied database, served by its own HTTP server, with helpers to seed rows and sign in. Each test
 * builds its own and closes it, so tests never share data or connections.
 */
export async function testApp() {
  shared ??= createDb();
  const db: Db = await shared;
  await db.query(`truncate table ${TABLES} restart identity cascade`);
  const mailer = memoryMailer();
  const app = createApp({ db, mailer });
  // One server per test, closed with its connections: no kept-alive socket reaches another test's server.
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
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
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    app,
    db,
    mailer,
    seed,
    auth,
    http: () => request(url),
    /** Closes this test's server and its connections; the database stays for the next test of the file. */
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export type TestApp = Awaited<ReturnType<typeof testApp>>;
