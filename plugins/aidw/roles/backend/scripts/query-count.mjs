#!/usr/bin/env node
// query-count: how many queries a request or a test runs, for 1 row and for N rows (rule B11: the count of a list
// does not grow with the rows). A backend Role tool (advisory). A CLI and a module. Node built-ins only.
const HELP = `
Usage: node query-count.mjs --log <file> [--one <label> --many <label>] [--pattern <re>] [--text]
       node query-count.mjs --one <log of 1 row> --many <log of N rows> [--pattern <re>] [--text]
       node query-count.mjs --run "<test command>" [--log <file>] [--timeout <s>] [--one <label> --many <label>]

Counts the SQL statements in a query log and compares two measurements: "one" (the list with 1 row) and "many"
(the same list with N rows). grows: true means the count rises with the rows (an N+1); grows: null means nothing
was counted at all, which proves nothing.

  --log <file>      a query log; a line "-- aidw:query-count <label>" starts a labelled section (the module's
                    mark() writes it). With --one/--many, those are section labels of this log. A path is relative
                    to the working directory.
  --one, --many     without --log: two log files to count and compare; with --log or --run: two section labels
  --run "<cmd>"     for a one-off measurement: runs the command through the shell with AIDW_QUERY_LOG=<log> in its
                    environment, then counts the log. The log is a fresh temp file, or --log when that file is new,
                    empty or already a log this tool wrote (it is emptied first; any other file is refused, exit 2).
                    The command's exit code, signal or error is reported, never a failure here. --run executes
                    code: a read-only reviewer must not use it; it reads a log the tests already wrote.
  --timeout <s>     seconds --run may take before the command is stopped (default 600)
  --pattern <re>    a line counts as one statement when it matches this regular expression. Default: a line with
                    SQL context (SELECT ... FROM, INSERT INTO, UPDATE x SET, DELETE FROM, WITH x AS (, MERGE INTO,
                    REPLACE INTO; upper case anywhere, any case at the start of the line or after "query:"; SELECT
                    or UPDATE x whose FROM or SET starts the next line), or a line the module wrote
  --text            short text instead of JSON
  --help            this text

Output (JSON): { tool, schemaVersion: 1, run?: { command, exitCode, signal?, error?, output? }, log?, total?,
  sections?: [{ label, count }], one, many, difference, grows, note? }

In a test, the assertion is what stays. Copy createCounter below (it is self-contained) into the
project's test helpers rather than importing this file from the plugin, then:

  const counter = createCounter();               // with $AIDW_QUERY_LOG set it also writes the log --run reads
  const restore = counter.wrap(pool, ["query"]); // node-postgres, mysql2 ("query", "execute"), any driver object
  // better-sqlite3: counter.wrapStatements(db) counts each statement's run/get/all/iterate (wrapping "prepare"
  //   would count preparations, not executions)
  // or a listener: prisma.$on("query", counter.tick); drizzle({ logger: { logQuery: counter.tick } });
  //   knex.on("query", (q) => counter.tick(q.sql)); new Sequelize(url, { logging: counter.tick })
  await seed(1);  const one = await counter.measure(() => request(app).get("/posts"));
  await seed(20); const many = await counter.measure(() => request(app).get("/posts"));
  expect(many.count).toBe(one.count);
  restore();
  // counter.mark("one") / counter.mark("many") label the log for: --log q.log --one one --many many

Other stacks: Django has assertNumQueries / CaptureQueriesContext; SQLAlchemy counts with
event.listen(engine, "before_cursor_execute", ...) or echo=True into a log this script reads.

Limits: counting a log is line-based: a statement spread over lines counts once, a subquery that starts its own
line counts again, a SELECT with no FROM (SELECT 1) is not counted; use --pattern for a log this does not fit.
BEGIN and COMMIT are not counted.

Exit: 0 when the count ran (whatever it found), 2 on a usage or read error.
`;

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli, UsageError } from "./_common.mjs";

const MARK = /aidw:query-count\s+(\S.*?)\s*$/;
const FORMS = String.raw`SELECT\b.*?\bFROM\b|INSERT\s+INTO\b|DELETE\s+FROM\b|MERGE\s+INTO\b|REPLACE\s+INTO\b|UPDATE\s+\S+\s+SET\b|WITH\s+\w+\s+AS\s*\(`;
const OPEN = String.raw`SELECT\b(?!.*\bFROM\b)|UPDATE\s+\S+\s*$`; // FROM or SET on the next line
const UPPER = new RegExp(`(?:^|[\\s:)\\]>])(?:${FORMS})`);
const LOWER = new RegExp(`^\\s*(?:query:?\\s+)?(?:${FORMS})`, "i");
const UPPER_OPEN = new RegExp(`(?:^|[\\s:)\\]>])(?:${OPEN})`);
const LOWER_OPEN = new RegExp(`^\\s*(?:query:?\\s+)?(?:${OPEN})`, "i");
const CONTINUES = /^\s*(?:FROM|SET)\b/i;
const OWN = /^\s*aidw:query\b/;

/** Counts statements in a log: { total, sections: [{ label, count }] } (label null for lines before any mark). */
export function countLog(text, pattern) {
  const re = pattern ? new RegExp(pattern) : null;
  const sections = [{ label: null, count: 0 }];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const mark = MARK.exec(line);
    if (mark) { sections.push({ label: mark[1], count: 0 }); return; }
    const statement = re
      ? re.test(line)
      : OWN.test(line) || UPPER.test(line) || LOWER.test(line) || ((UPPER_OPEN.test(line) || LOWER_OPEN.test(line)) && CONTINUES.test(lines[i + 1] ?? ""));
    if (statement) sections[sections.length - 1].count++;
  });
  return { total: sections.reduce((n, s) => n + s.count, 0), sections: sections.filter((s) => s.label !== null || s.count > 0) };
}

/** { one, many, difference, grows } of two counts; grows is null (with a note) when both are 0. */
export const compare = (one, many) =>
  one === 0 && many === 0
    ? { one, many, difference: 0, grows: null, note: "no statements counted: the counter or the log saw no queries" }
    : { one, many, difference: many - one, grows: many > one };

/**
 * A query counter for a test. tick() counts one query (pass it as an ORM's query listener); wrap() counts the calls
 * of a driver's methods and returns a function that restores them; measure(fn) runs fn and returns the queries it
 * ran; mark(label) starts a labelled section in the log. With a log file (default $AIDW_QUERY_LOG) every query is
 * also appended to it as "aidw:query <sql>".
 */
export function createCounter({ log = process.env.AIDW_QUERY_LOG } = {}) {
  const counter = {
    count: 0,
    tick: (q) => {
      counter.count++;
      if (log) {
        const sql = typeof q === "string" ? q : (q?.query ?? q?.sql ?? q?.text ?? "");
        appendFileSync(log, `aidw:query ${String(sql).replace(/\s+/g, " ").slice(0, 200)}\n`);
      }
    },
    reset: () => { counter.count = 0; },
    mark: (label) => { if (log) appendFileSync(log, `-- aidw:query-count ${label}\n`); },
    wrap: (target, methods = ["query", "execute"]) => {
      const originals = [];
      for (const name of methods) {
        const original = target[name];
        if (typeof original !== "function") continue;
        originals.push([name, original, Object.prototype.hasOwnProperty.call(target, name)]);
        target[name] = function (...args) { counter.tick(args[0]); return original.apply(this, args); };
      }
      return () => { for (const [name, original, own] of originals) { if (own) target[name] = original; else delete target[name]; } };
    },
    wrapStatements: (db, methods = ["run", "get", "all", "iterate"], prepare = "prepare") => {
      const original = db[prepare];
      const own = Object.prototype.hasOwnProperty.call(db, prepare);
      db[prepare] = function (...args) {
        const statement = original.apply(this, args);
        for (const name of methods) {
          const run = statement?.[name];
          if (typeof run === "function") statement[name] = function (...a) { counter.tick(args[0]); return run.apply(this, a); };
        }
        return statement;
      };
      return () => { if (own) db[prepare] = original; else delete db[prepare]; };
    },
    measure: async (fn) => {
      const start = counter.count;
      const result = await fn();
      return { count: counter.count - start, result };
    },
  };
  return counter;
}

async function main() {
  const readLog = (file) => {
    if (!existsSync(file)) throw new UsageError(`no log at ${file}`);
    return readFileSync(file, "utf8");
  };
  await runCli({
    tool: "query-count",
    help: HELP,
    options: { log: { type: "string" }, one: { type: "string" }, many: { type: "string" }, run: { type: "string" }, pattern: { type: "string" }, timeout: { type: "string" } },
    main(values, positionals) {
      if (positionals.length) throw new UsageError(`unexpected argument ${positionals[0]}. See --help.`);
      if (values.pattern) { try { new RegExp(values.pattern); } catch (e) { throw new UsageError(`--pattern: ${e.message}`); } }
      if ((values.one === undefined) !== (values.many === undefined)) throw new UsageError("--one and --many go together. See --help.");
      if (!values.run && !values.log && values.one === undefined) throw new UsageError("give --log, or --one and --many, or --run. See --help.");
      const timeout = values.timeout === undefined ? 600 : Number(values.timeout);
      if (!(timeout > 0)) throw new UsageError("--timeout takes a number of seconds above 0");
      const result = {};
      if (values.run) {
        let log;
        if (values.log) {
          log = resolve(values.log);
          if (existsSync(log)) {
            const before = readFileSync(log, "utf8");
            if (before.trim() !== "" && !/aidw:query/.test(before)) throw new UsageError(`refusing to empty ${values.log}: it is not a query log this tool wrote. Give a new file, or leave out --log.`);
          }
        } else log = join(mkdtempSync(join(tmpdir(), "aidw-query-count-")), "queries.log");
        writeFileSync(log, "");
        values.log = log;
        const r = spawnSync(values.run, { shell: true, encoding: "utf8", env: { ...process.env, AIDW_QUERY_LOG: log }, maxBuffer: 64 * 1024 * 1024, timeout: timeout * 1000, killSignal: "SIGKILL" });
        result.run = { command: values.run, exitCode: r.status };
        if (r.signal) result.run.signal = r.signal;
        if (r.error) result.run.error = r.error.code === "ETIMEDOUT" ? `stopped after ${timeout} s` : r.error.message;
        if (r.status !== 0) result.run.output = `${r.stdout ?? ""}${r.stderr ?? ""}`.slice(-2000);
      }
      if (values.log) {
        const counted = countLog(readLog(values.log), values.pattern);
        Object.assign(result, { log: values.log, total: counted.total, sections: counted.sections });
        if (values.one !== undefined) {
          const one = counted.sections.find((s) => s.label === values.one);
          const many = counted.sections.find((s) => s.label === values.many);
          if (one && many) Object.assign(result, compare(one.count, many.count));
          else result.note = `no section labelled ${[one ? null : values.one, many ? null : values.many].filter(Boolean).join(" or ")} in ${values.log}`;
        }
      } else {
        Object.assign(result, compare(countLog(readLog(values.one), values.pattern).total, countLog(readLog(values.many), values.pattern).total));
      }
      return result;
    },
    text(r) {
      const out = [];
      if (r.run) out.push(`ran: ${r.run.command} (exit ${r.run.exitCode})`);
      if (r.sections) out.push(`${r.log}: ${r.total} statements${r.sections.length ? ` (${r.sections.map((s) => `${s.label ?? "unlabelled"} ${s.count}`).join(", ")})` : ""}`);
      if (r.run?.signal || r.run?.error) out.push(`the command was stopped: ${r.run.error ?? r.run.signal}`);
      if (r.one !== undefined) out.push(`one ${r.one}, many ${r.many}, difference ${r.difference}${r.grows === null ? "" : `: ${r.grows ? "GROWS with the rows" : "does not grow"}`}`);
      if (r.note) out.push(r.note);
      return out.join("\n") + "\n";
    },
  });
}

const isMain = (() => {
  try { return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) await main();
