import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Exec } from "../src/evalrun.js";
import { ensureFixturePackages, fixturesDir, loadLevel2Cases, prepareCopy, removeTree, runCheck, runLevel2, type AgentRunner, type Level2Case } from "../src/evallevel2.js";

/**
 * The backend level 2 cases after the pilot (charge-once, email-after-the-order, two-requests-one-slot) on the
 * backend-api fixture, with no model: for each, the correct reference solution passes the held-out tests and every check
 * of checks.yaml (and a whole run with a stand-in Agent), each wrong reference solution fails the held-out tests that
 * catch its flaw, and the untouched fixture fails. Needs the fixture's packages in the cache (AIDW_FIXTURE_CACHE) and
 * the built plugin bin (checks run `aidw plugin-path`); skipped without them.
 */
const repo = join(__dirname, "..");
const plugin = join(repo, "plugins", "aidw");
const fixture = join(fixturesDir(plugin), "backend-api");
const reference = join(repo, "evals", "level2-reference");
const noInstall = () => {
  throw new Error("not installed");
};
let nodeModules: string | null = null;
try {
  nodeModules = ensureFixturePackages(fixture, "backend-api", process.env, noInstall).nodeModules;
} catch {
  nodeModules = null;
}
const ready = !!nodeModules && existsSync(join(plugin, "bin", "aidw"));
const temps: string[] = [];
afterAll(() => temps.forEach(removeTree));
const caseOf = (name: string): Level2Case => loadLevel2Cases(plugin, "backend").cases.find((c) => c.name === name)!;
const temp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  temps.push(d);
  return d;
};

/** A prepared copy of the case's Change with the overlays laid over it (as an Agent would leave it), then the held-out files. */
function graded(c: Level2Case, ...overlays: string[]) {
  const prep = prepareCopy(plugin, c, fixture, nodeModules as string, join(temp("aidw-l2fc-"), "project"));
  for (const o of overlays) cpSync(join(reference, o), prep.project, { recursive: true });
  cpSync(join(plugin, c.dir, "held-out"), prep.project, { recursive: true });
  const env = { ...process.env, PATH: [join(plugin, "bin"), process.env.PATH].join(":"), AIDW_BASE: prep.base, AIDW_PROJECT: prep.project, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" };
  const check = (name: RegExp) => runCheck(c.checks.find((ch) => name.test(ch.name))!, prep.project, env);
  const heldOut = () => {
    const r = spawnSync("sh", ["-c", `npm test --silent -- ${c.heldOut.join(" ")}`], { cwd: prep.project, env, encoding: "utf8", timeout: 240_000 });
    return { status: r.status, out: `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "") };
  };
  return { prep, project: prep.project, env, check, heldOut };
}

/** The held-out tests a run reports as failed, by the words of their names. */
const failedTests = (out: string) => [...out.matchAll(/(?:×|FAIL) .*?> ([^\n]+?)(?: \d+ms)?$/gm)].map((m) => m[1]!);

/** A session that lays the case's reference solution over the copy and reads the case's must_read files. */
const overlayAgent =
  (c: Level2Case, overlays: string[]): AgentRunner =>
  (i) => {
    for (const o of overlays) cpSync(join(reference, o), i.cwd, { recursive: true });
    const brief = i.prompt.replace(/^Task brief: (.*)\. Read it.*$/, "$1");
    const reads = [brief, ...c.mustRead.map((p) => (p.startsWith("plugin:") ? join(i.pluginRoot, p.slice(7)) : join(i.cwd, p)))];
    const lines = [
      ...reads.map((file_path, n) => ({ type: "assistant", parent_tool_use_id: null, message: { id: `m${n}`, content: [{ type: "tool_use", name: "Read", input: { file_path } }] } })),
      { type: "result", subtype: "success", result: "Works now: all scenarios. A key stuck in progress is taken over after 2 minutes and charged again with the same provider key." },
    ];
    writeFileSync(i.logFile, lines.map((l) => JSON.stringify(l)).join("\n"));
    return { exit: 0, timedOut: false, turnLimit: false, turns: lines.length - 1 };
  };

interface Spec {
  name: string;
  checks: number;
  wrong: { overlay: string; fails: RegExp[] }[];
  /** Wrong solutions the held-out tests let pass and a check of checks.yaml catches. */
  byCheck?: { overlay: string; check: RegExp }[];
  /**
   * Known limits: wrong solutions that pass the held-out tests and every check, because a tool cannot see the flaw (the
   * scripts do not follow fetch options built in a variable). Recorded with it.fails: when a check catches one, move it.
   */
  limits?: { overlay: string }[];
}

const SPECS: Spec[] = [
  {
    name: "charge-once",
    checks: 6,
    wrong: [
      { overlay: "charge-once-no-key-store", fails: [/same request sent again after it finished/, /key reused for another request/, /request still running/] },
      { overlay: "charge-once-fresh-provider-key", fails: [/provider does not answer/, /provider charged but its answer was lost/] },
      { overlay: "charge-once-charges-in-transaction", fails: [/request still running/] },
      { overlay: "charge-once-key-not-scoped", fails: [/keys belong to the caller/] },
      { overlay: "charge-once-provider-key-not-scoped", fails: [/keys belong to the caller/] },
      { overlay: "charge-once-no-fingerprint", fails: [/key reused for another request/] },
      { overlay: "charge-once-fingerprint-without-invoice", fails: [/key reused for another request/] },
      { overlay: "charge-once-declined-not-stored", fails: [/card declined/] },
      { overlay: "charge-once-provider-key-per-payment", fails: [/provider does not answer/, /provider charged but its answer was lost/] },
      { overlay: "charge-once-unavailable-left-in-progress", fails: [/provider does not answer/, /provider charged but its answer was lost/] },
      { overlay: "charge-once-forgets-key-after-502", fails: [/after a 502 the key keeps its request/] },
      { overlay: "charge-once-no-takeover", fails: [/a key left in progress for more than 2 minutes/] },
    ],
    byCheck: [{ overlay: "charge-once-fetch-without-timeout", check: /leak-and-timeout-scan/ }],
    limits: [{ overlay: "limit-charge-once-fetch-init-in-variable" }],
  },
  {
    name: "email-after-the-order",
    checks: 6,
    wrong: [
      { overlay: "email-after-the-order-sends-in-transaction", fails: [/order write fails part way/, /mail provider down/] },
      { overlay: "email-after-the-order-unclaimed-sender", fails: [/sender runs twice at the same moment/, /a send whose answer was lost/] },
      { overlay: "email-after-the-order-outbox-before-transaction", fails: [/order write fails part way/] },
      { overlay: "email-after-the-order-marks-sent-first", fails: [/mail provider down/, /gives a confirmation up after 5/] },
      { overlay: "email-after-the-order-no-retry-cap", fails: [/gives a confirmation up after 5/] },
      { overlay: "email-after-the-order-no-idempotency-key", fails: [/a send whose answer was lost/] },
      { overlay: "email-after-the-order-key-per-attempt", fails: [/a send whose answer was lost/] },
      { overlay: "email-after-the-order-no-timeout", fails: [/sent with a timeout/] },
      { overlay: "email-after-the-order-claim-without-condition", fails: [/sender runs twice at the same moment/] },
      { overlay: "email-after-the-order-outbox-after-commit", fails: [/the owed email is recorded in the order.s transaction/] },
      { overlay: "email-after-the-order-sends-in-claim-transaction", fails: [/the sender holds no transaction open/] },
    ],
  },
  {
    name: "two-requests-one-slot",
    checks: 5,
    wrong: [
      { overlay: "two-requests-one-slot-check-then-insert", fails: [/two bookings at once/, /another booking lands between/] },
      // PGlite serialises transactions: only the rival inserted from inside the route's insert catches this one
      { overlay: "two-requests-one-slot-check-in-transaction", fails: [/another booking lands between/] },
      { overlay: "two-requests-one-slot-for-update-then-insert", fails: [/another booking lands between/] },
      { overlay: "two-requests-one-slot-on-conflict-without-predicate", fails: [/books a free slot/, /two bookings at once/] },
      { overlay: "two-requests-one-slot-check-on-team", fails: [/another room and the next hour/] },
      { overlay: "two-requests-one-slot-every-error-is-409", fails: [/fails for another reason than the slot/] },
    ],
  },
];

for (const s of SPECS) {
  describe.skipIf(!ready)(`level 2 case ${s.name} on the backend-api fixture`, () => {
    it("loads, on its own Change of the fixture", () => {
      const { cases, diags } = loadLevel2Cases(plugin, "backend");
      expect(diags.errors).toEqual([]);
      const c = cases.find((x) => x.name === s.name)!;
      expect(c.change).toBeTruthy();
      expect(existsSync(join(fixture, ".aidw", "changes", c.change!, "tasks.yaml"))).toBe(true);
      expect(c.restore).toEqual(["tests/helpers.ts", "tests/http.ts"]);
      expect(c.checks).toHaveLength(s.checks);
    });

    it("the correct reference solution passes the held-out tests and every check of checks.yaml", () => {
      const c = caseOf(s.name);
      const g = graded(c, s.name);
      const t = g.heldOut();
      expect(t.status, t.out).toBe(0);
      const results = c.checks.map((ch) => [ch.name, runCheck(ch, g.project, g.env)] as const);
      expect(results.filter(([, r]) => !r.pass)).toEqual([]);
    }, 600_000);

    for (const w of s.wrong) {
      it(`the wrong solution ${w.overlay} fails the held-out tests that catch it`, () => {
        const g = graded(caseOf(s.name), s.name, w.overlay);
        const t = g.heldOut();
        expect(t.status).not.toBe(0);
        const failed = failedTests(t.out).join("\n");
        for (const f of w.fails) expect(failed, t.out).toMatch(f);
      }, 600_000);
    }

    for (const w of s.byCheck ?? []) {
      it(`the wrong solution ${w.overlay} passes the held-out tests and fails the check that catches it`, () => {
        const g = graded(caseOf(s.name), s.name, w.overlay);
        const t = g.heldOut();
        expect(t.status, t.out).toBe(0);
        expect(g.check(w.check).pass).toBe(false);
      }, 600_000);
    }

    for (const w of s.limits ?? []) {
      // it.fails: the body asserts that the case catches the flaw, which a tool cannot see today. When a check is changed
      // so that it catches it, this fails: move the entry to `wrong` or `byCheck`.
      it.fails(`known limit: the wrong solution ${w.overlay} is caught by the held-out tests or a check (it is not)`, () => {
        const c = caseOf(s.name);
        const g = graded(c, s.name, w.overlay);
        const t = g.heldOut();
        const failedChecks = t.status === 0 ? c.checks.filter((ch) => !runCheck(ch, g.project, g.env).pass).map((ch) => ch.name) : [];
        expect(t.status !== 0 || failedChecks.length > 0, `${t.out}\nfailed checks: ${failedChecks.join(", ")}`).toBe(true);
      }, 600_000);
    }

    it("the untouched fixture fails the held-out tests, route-inventory and the scenario-id check", () => {
      const g = graded(caseOf(s.name));
      expect(g.heldOut().status).not.toBe(0);
      expect(g.check(/route-inventory/).pass).toBe(false);
      expect(g.check(/scenario id/)).toMatchObject({ pass: false, why: expect.stringMatching(/no test names /) });
    }, 600_000);

    it("passes a whole run on the correct reference solution: tests, checks, reads, and the grader for the criteria", () => {
      const c = caseOf(s.name);
      const prompts: string[] = [];
      const exec: Exec = (prompt) => {
        prompts.push(prompt);
        return JSON.stringify(c.criteria.map((_, n) => ({ n: n + 1, pass: true, reason: "it does" })));
      };
      const [r] = runLevel2({ root: plugin, role: "backend", runs: 1, agent: overlayAgent(c, [s.name]), exec, install: noInstall, runsDir: temp("aidw-l2fc-runs-") }, s.name);
      const x = r!.results[0]!;
      expect(x.error).toBeUndefined();
      expect(x.steps.filter((st) => !st.pass), JSON.stringify(x.steps.filter((st) => !st.pass))).toEqual([]);
      expect(r!.pass).toBe(true);
      expect(prompts).toHaveLength(c.criteria.length ? 1 : 0);
    }, 600_000);
  });
}
