import { readFileSync } from "node:fs";
import { PGlite, type Transaction } from "@electric-sql/pglite";

/** What the code uses of the database: parameterised queries and transactions. Postgres, in process (PGlite). */
export interface Db {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<R>(fn: (tx: Queryable) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}
export interface Queryable {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

const schema = () => readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

/** A database with the schema applied. `dataDir` keeps it on disk; without it, it lives in memory (tests). */
export async function createDb(dataDir?: string): Promise<Db> {
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  const tables = await pg.query<{ n: number }>("select count(*)::int as n from information_schema.tables where table_name = 'users'");
  if (!tables.rows[0]?.n) await pg.exec(schema());
  const wrap = (q: PGlite | Transaction): Queryable => ({
    async query<T>(sql: string, params: unknown[] = []) {
      return (await q.query<T>(sql, params)).rows;
    },
  });
  return {
    ...wrap(pg),
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
    close: () => pg.close(),
  };
}
