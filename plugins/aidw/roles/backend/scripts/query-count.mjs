#!/usr/bin/env node
// query-count: how many queries a request or a test runs, for 1 row and for N rows (rule B11: the count of a list
// does not grow with the rows). A backend Role tool (advisory). A CLI and a module. Node built-ins only.
const HELP = `
Usage: node query-count.mjs --log <file> [--one <label> --many <label>] [--run "<test command>"] [--pattern <re>] [--text]
       node query-count.mjs --one <log of 1 row> --many <log of N rows> [--pattern <re>] [--text]

Counts the SQL statements in a query log and compares two measurements: "one" (the list with 1 row) and "many"
(the same list with N rows). grows: true means the count rises with the rows (an N+1).

  --log <file>      a query log; a line "-- aidw:query-count <label>" starts a labelled section (the module's
                    mark() writes it). With --one/--many, those are section labels of this log.
  --one, --many     without --log: two log files to count and compare; with --log: two section labels
  --run "<cmd>"     empties --log, runs the command through the shell with AIDW_QUERY_LOG=<absolute log path> in
                    its environment, then counts. The command's exit code is reported, never a failure here.
  --pattern <re>    a line counts as one statement when it matches this regular expression (default: an ORM log
                    line with SELECT, INSERT INTO, UPDATE, DELETE FROM, WITH, MERGE INTO or REPLACE INTO, or a
                    line the module wrote)
  --text            short text instead of JSON
  --help            this text

Output (JSON): { log?, total?, sections?: [{ label, count }], one, many, difference, grows, run?: { command,
  exitCode, output? }, note? }

As a module, in a Node test (import it by the path that \`aidw plugin-path roles/backend/scripts/query-count.mjs\`
prints, or copy the measurement into the test):

  import { createCounter } from "<path>/query-count.mjs";
  const counter = createCounter();               // logs to $AIDW_QUERY_LOG when set (so --run can read it)
  const restore = counter.wrap(pool, ["query"]); // node-postgres, mysql2, better-sqlite3 ("prepare"), any driver
  // or a listener: prisma.$on("query", counter.tick); drizzle({ logger: { logQuery: counter.tick } });
  //   knex.on("query", (q) => counter.tick(q.sql)); new Sequelize(url, { logging: counter.tick })
  await seed(1);  const one = await counter.measure(() => request(app).get("/posts"));
  await seed(20); const many = await counter.measure(() => request(app).get("/posts"));
  expect(many.count).toBe(one.count);            // the assertion the test keeps
  restore();
  // counter.mark("one") / counter.mark("many") label the log for: node query-count.mjs --log q.log --one one --many many

Other stacks: Django has assertNumQueries / CaptureQueriesContext; SQLAlchemy counts with
event.listen(engine, "before_cursor_execute", ...) or echo=True into a log this script reads.

Limits: counting a log is line-based: a statement spread over lines counts once, a subquery that starts its own
line counts again; use --pattern for a log this does not fit. BEGIN and COMMIT are not counted.

Exit: 0 when the count ran (whatever it found), 2 on a usage or read error.
`;

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli, UsageError } from "./_common.mjs";

const MARK = /aidw:query-count\s+(\S.*?)\s*$/;
const UPPER = /(?:^|[\s:)\]>])(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WITH|MERGE\s+INTO|REPLACE\s+INTO)\s/;
const LOWER = /^\s*(?:query:?\s+)?(?:select|insert\s+into|update|delete\s+from|with)\s/i;
const OWN = /^\s*aidw:query\b/;

/** Counts statements in a log: { total, sections: [{ label, count }] } (label null for lines before any mark). */
export function countLog(text, pattern) {
  const re = pattern ? new RegExp(pattern) : null;
  const sections = [{ label: null, count: 0 }];
  for (const line of text.split(/\r?\n/)) {
    const mark = MARK.exec(line);
    if (mark) { sections.push({ label: mark[1], count: 0 }); continue; }
    if (re ? re.test(line) : OWN.test(line) || UPPER.test(line) || LOWER.test(line)) sections[sections.length - 1].count++;
  }
  return { total: sections.reduce((n, s) => n + s.count, 0), sections: sections.filter((s) => s.label !== null || s.count > 0) };
}

/** { one, many, difference, grows } of two counts. */
export const compare = (one, many) => ({ one, many, difference: many - one, grows: many > one });

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
    help: HELP,
    options: { log: { type: "string" }, one: { type: "string" }, many: { type: "string" }, run: { type: "string" }, pattern: { type: "string" } },
    main(values, positionals) {
      if (positionals.length) throw new UsageError(`unexpected argument ${positionals[0]}. See --help.`);
      if (values.pattern) { try { new RegExp(values.pattern); } catch (e) { throw new UsageError(`--pattern: ${e.message}`); } }
      if ((values.one === undefined) !== (values.many === undefined)) throw new UsageError("--one and --many go together. See --help.");
      if (values.run && !values.log) throw new UsageError("--run needs --log, the file the test writes. See --help.");
      if (!values.log && values.one === undefined) throw new UsageError("give --log, or --one and --many. See --help.");
      const result = {};
      if (values.run) {
        const log = resolve(values.log);
        writeFileSync(log, "");
        const r = spawnSync(values.run, { shell: true, encoding: "utf8", env: { ...process.env, AIDW_QUERY_LOG: log }, maxBuffer: 64 * 1024 * 1024 });
        result.run = { command: values.run, exitCode: r.status };
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
      if (r.one !== undefined) out.push(`one ${r.one}, many ${r.many}, difference ${r.difference}: ${r.grows ? "GROWS with the rows" : "does not grow"}`);
      if (r.note) out.push(r.note);
      return out.join("\n") + "\n";
    },
  });
}

const isMain = (() => {
  try { return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) await main();
