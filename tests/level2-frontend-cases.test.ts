import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Exec } from "../src/evalrun.js";
import { ensureFixturePackages, fixturesDir, loadLevel2Cases, prepareCopy, removeTree, runCheck, runLevel2, type AgentRunner, type Level2Case } from "../src/evallevel2.js";

/**
 * The frontend level 2 cases after the pilot (people-search, invite-form, billing-page-guard) on the frontend-web
 * fixture, with no model: each case's Change is approved and valid, its scenarios are the ones its tasks, checks, tests
 * and held-out tests name, the correct reference solution passes every held-out test and every check, each wrong one (a
 * copy of one planted trap) fails the held-out test meant for it and only those, a reworded correct one passes, the
 * untouched fixture fails, and the checks that run a Role script run only once the script is in the plugin (two of them
 * are written on another branch). Needs the fixture's packages in the cache (AIDW_FIXTURE_CACHE) and the built plugin
 * bin; skipped without them.
 */
const repo = join(__dirname, "..");
const plugin = join(repo, "plugins", "aidw");
const fixture = join(fixturesDir(plugin), "frontend-web");
const reference = join(repo, "evals", "level2-reference");
const noInstall = () => {
  throw new Error("not installed");
};
let nodeModules: string | null = null;
try {
  nodeModules = ensureFixturePackages(fixture, "frontend-web", process.env, noInstall).nodeModules;
} catch {
  nodeModules = null;
}
const ready = !!nodeModules && existsSync(join(plugin, "bin", "aidw"));
const scriptMissing = (name: string) => !existsSync(join(plugin, "roles", "frontend", "scripts", `${name}.mjs`));

const temps: string[] = [];
afterAll(() => temps.forEach(removeTree));
const temp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  temps.push(d);
  return d;
};
const theCase = (name: string): Level2Case => loadLevel2Cases(plugin, "frontend").cases.find((c) => c.name === name)!;

type Prep = ReturnType<typeof prepareCopy>;
function commands(c: Level2Case, prep: Prep) {
  const env = { ...process.env, PATH: [join(plugin, "bin"), process.env.PATH].join(":"), AIDW_BASE: prep.base, AIDW_PROJECT: prep.project, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" };
  const check = (name: RegExp) => runCheck(c.checks.find((ch) => name.test(ch.name))!, prep.project, env);
  const sh = (cmd: string) => {
    const r = spawnSync("sh", ["-c", cmd], { cwd: prep.project, env, encoding: "utf8", timeout: 240_000 });
    return { status: r.status, out: `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "") };
  };
  const heldOut = () => sh(`npm test --silent -- ${c.heldOut.join(" ")}`);
  return { prep, project: prep.project, env, check, sh, heldOut };
}
type G = ReturnType<typeof commands>;

/** A prepared copy of the case's Change with the overlays laid over it (as an Agent would leave it), then the held-out files. */
function graded(c: Level2Case, ...overlays: string[]): G {
  const prep = prepareCopy(plugin, c, fixture, nodeModules as string, join(temp("aidw-l2fe-"), "project"));
  for (const o of overlays) cpSync(join(reference, o), prep.project, { recursive: true });
  cpSync(join(plugin, c.dir, "held-out"), prep.project, { recursive: true });
  return commands(c, prep);
}

/** The held-out tests a run reports as failed, by the words of their names. */
const failedTests = (out: string) => [...new Set([...out.matchAll(/(?:×|FAIL) .*?> ([^\n]+)$/gm)].map((m) => m[1]!.split(" > ").pop()!.replace(/\s+\d+ms\s*$/, "").trim()))];
const put = (g: G, rel: string, text: string) => {
  mkdirSync(dirname(join(g.project, rel)), { recursive: true });
  writeFileSync(join(g.project, rel), text);
};
/** Replaces text in a file of the copy; throws when there is nothing to replace (a variant that silently changed nothing would pass). */
const swap = (g: G, rel: string, from: string | RegExp, to: string) => {
  const p = join(g.project, rel);
  const s = readFileSync(p, "utf8");
  const t = s.replace(from, to);
  if (t === s) throw new Error(`nothing to replace for ${String(from)} in ${rel}`);
  writeFileSync(p, t);
};

interface Wrong {
  overlay: string;
  fails: RegExp[];
  passes: RegExp[];
  /** a check (by a word of its name) that must fail on it, once its script is in the plugin */
  check?: RegExp;
  /** a script the check above runs */
  script?: string;
}
interface Spec {
  name: string;
  change: string;
  capability: string;
  requirement: string;
  /** held-out test titles (their words) and the scenario each one proves */
  maps: [RegExp, string][];
  /** the Role scripts the checks run: a check whose script is missing is left out */
  scripts: string[];
  reference: string;
  reworded: string;
  wrong: Wrong[];
  /** a file outside Touches whose change the Touches check must refuse */
  outside: string;
  /** a sentence of the Agent's report that answers the case's criterion */
  found: string;
  /** the words of the check that proves the scripts' part on the correct reference */
  tokensCheck?: boolean;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function scenariosOf(spec: Spec): string[] {
  const file = join(fixture, ".aidw", "changes", spec.change, "specs", spec.capability, "spec.md");
  return [...readFileSync(file, "utf8").matchAll(/^#### Scenario: (.+)$/gm)].map((m) => slug(m[1]!));
}

function suite(spec: Spec, extra: (c: () => Level2Case) => void = () => {}) {
  const c = () => theCase(spec.name);
  const missing = spec.scripts.filter(scriptMissing);
  const waits = (checkName: string) => missing.some((s) => checkName.includes(s));

  describe.skipIf(!ready)(`frontend level 2 case ${spec.name} (cached packages)`, () => {
    it("loads on the fixture's Change, with screenshots off, the test harness restored and its skills to read", () => {
      const { cases, diags } = loadLevel2Cases(plugin, "frontend");
      expect(diags.errors).toEqual([]);
      const x = cases.find((k) => k.name === spec.name)!;
      expect(x).toMatchObject({ fixture: "frontend-web", change: spec.change, task: "T01", screenshots: false, timeoutMin: 35, maxTurns: 90 });
      expect(x.restore).toEqual(expect.arrayContaining([".aidw/design/tokens.yaml", "tests/setup.ts", "tests/msw/handlers.ts", "tests/msw/server.ts"]));
      expect(x.heldOut).toHaveLength(1);
      expect(x.criteria).toHaveLength(1);
      expect(x.mustRead[0]).toBe(`.aidw/changes/${spec.change}/api-contract.md`);
    });

    it("every scenario of the Change is on its task, named by a check and by the reference's tests, and every held-out test proves one", () => {
      const scenarios = scenariosOf(spec);
      expect(scenarios.length).toBeGreaterThan(4);
      const tasks = readFileSync(join(fixture, ".aidw", "changes", spec.change, "tasks.yaml"), "utf8");
      const onTask = [...tasks.matchAll(/^\s+- (\S+\/\S+\/\S+)$/gm)].map((m) => m[1]!);
      expect(onTask).toEqual(scenarios.map((s) => `${spec.capability}/${spec.requirement}/${s}`));
      const idCheck = c().checks.find((ch) => /every scenario id/.test(ch.name))!.run;
      for (const s of scenarios) expect(idCheck, s).toContain(s);
      const refTests = readdirSync(join(reference, spec.reference, "tests")).flatMap((d) => readdirSync(join(reference, spec.reference, "tests", d)).map((f) => readFileSync(join(reference, spec.reference, "tests", d, f), "utf8")));
      for (const s of scenarios) expect(refTests.join("\n"), s).toContain(`${spec.capability}/${spec.requirement}/${s}`);
      const heldOut = readFileSync(join(plugin, c().dir, "held-out", c().heldOut[0]!), "utf8");
      const titles = [...heldOut.matchAll(/^\s+it\("(.+)", async \(\) => \{$/gm)].map((m) => m[1]!);
      expect(titles).toHaveLength(spec.maps.length);
      const proven = new Set<string>();
      for (const t of titles) {
        const hit = spec.maps.filter(([re]) => re.test(t));
        expect(hit, t).toHaveLength(1);
        expect(scenarios, t).toContain(hit[0]![1]);
        proven.add(hit[0]![1]);
      }
      // a scenario no held-out test proves is allowed only when the reference's own tests do (the check above)
      expect(proven.size).toBeGreaterThan(scenarios.length - 2);
    });

    it("briefs the task with the design tokens and without the screenshot lines, and names skills of the Role to read", () => {
      const prep = prepareCopy(plugin, c(), fixture, nodeModules as string, join(temp("aidw-l2fe-brief-"), "project"));
      expect(prep.briefText).toMatch(/## Design tokens \(approved; binding for UI\)/);
      expect(prep.briefText).not.toMatch(/Screenshots\*\*|Playwright|PNG/);
      expect(prep.briefText).toContain(c().change);
      for (const m of c().mustRead.filter((p) => p.startsWith("plugin:roles/frontend/skills/"))) {
        const skill = m.replace(/^plugin:roles\/frontend\/skills\//, "").replace(/\.md$/, "");
        // the skill is the Role's own (its load condition is in role.md), not a line of the brief
        expect(readFileSync(join(plugin, "roles", "frontend", "role.md"), "utf8"), skill).toMatch(new RegExp(`^  - ${skill}:`, "m"));
        expect(existsSync(join(plugin, "roles", "frontend", "skills", `${skill}.md`)), skill).toBe(true);
      }
    });

    it(`the correct reference solution passes the held-out tests and every check that can run (${spec.maps.length} of ${spec.maps.length})`, () => {
      const g = graded(c(), spec.reference);
      const t = g.heldOut();
      expect(t.status, t.out).toBe(0);
      expect(t.out).toContain(`${spec.maps.length} passed`);
      const results = c().checks.filter((ch) => !waits(ch.name)).map((ch) => [ch.name, runCheck(ch, g.project, g.env)] as const);
      expect(results).toHaveLength(c().checks.length - c().checks.filter((ch) => waits(ch.name)).length);
      expect(results.filter(([, r]) => !r.pass)).toEqual([]);
    }, 600_000);

    for (const w of spec.wrong) {
      it(`the wrong solution ${w.overlay} fails the held-out test meant for it, and only the tests its flaw breaks`, () => {
        const g = graded(c(), spec.reference, w.overlay);
        const t = g.heldOut();
        if (w.fails.length) {
          expect(t.status).not.toBe(0);
          const failed = failedTests(t.out).join("\n");
          for (const f of w.fails) expect(failed, t.out).toMatch(f);
          for (const p of w.passes) expect(failed, t.out).not.toMatch(p);
        } else {
          expect(t.status, t.out).toBe(0);
          expect(t.out).toContain(`${spec.maps.length} passed`);
        }
      }, 600_000);
      if (w.check) {
        it.skipIf(scriptMissing(w.script!))(`the check ${w.check} fails the wrong solution ${w.overlay}, and passes the correct one`, () => {
          const bad = graded(c(), spec.reference, w.overlay);
          expect(bad.check(w.check!), w.overlay).toMatchObject({ pass: false });
          expect(graded(c(), spec.reference).check(w.check!)).toMatchObject({ pass: true });
        }, 300_000);
      }
    }

    it(`a reference that words the texts and builds the same thing differently still passes the held-out tests (${spec.maps.length} of ${spec.maps.length})`, () => {
      const g = graded(c(), spec.reference, spec.reworded);
      const t = g.heldOut();
      expect(t.status, t.out).toBe(0);
      expect(t.out).toContain(`${spec.maps.length} passed`);
      for (const ch of c().checks.filter((x) => /Touches|token|a11y|public-env/.test(x.name) && !waits(x.name))) expect(runCheck(ch, g.project, g.env), ch.name).toMatchObject({ pass: true });
    }, 600_000);

    it("the untouched fixture fails every held-out test and the scenario-id check", () => {
      const g = graded(c());
      const t = g.heldOut();
      expect(t.status).not.toBe(0);
      expect(failedTests(t.out), t.out).toHaveLength(spec.maps.length);
      expect(g.check(/scenario id/)).toMatchObject({ pass: false, why: expect.stringMatching(/no test names /) });
    }, 600_000);

    it("the Touches check fails a solution that changes a file outside the task, and allows .aidw/run and .aidw/changes", () => {
      const g = graded(c(), spec.reference);
      const list = (files: string[]) => {
        const f = join(g.project, "..", "changed.txt");
        writeFileSync(f, files.join("\n") + "\n");
        return { ...g.env, AIDW_CHANGED: f };
      };
      const ch = c().checks.find((x) => /nothing outside Touches/.test(x.name))!;
      expect(runCheck(ch, g.project, list([`src/routes.tsx`, ".aidw/run/report-T01.md", `.aidw/changes/${spec.change}/tasks.yaml`]))).toMatchObject({ pass: true });
      for (const f of [spec.outside, ".aidw/design/tokens.yaml", ".aidw/constitution.md", "tests/msw/handlers.ts"]) expect(runCheck(ch, g.project, list([f])), f).toMatchObject({ pass: false });
    }, 300_000);

    /** A session that lays the reference solution over the copy and reads the case's must_read files. */
    const overlayAgent = (k: Level2Case): AgentRunner => (i) => {
      cpSync(join(reference, spec.reference), i.cwd, { recursive: true });
      const brief = i.prompt.replace(/^Task brief: (.*)\. Read it.*$/, "$1");
      const reads = [brief, ...k.mustRead.map((p) => (p.startsWith("plugin:") ? join(i.pluginRoot, p.slice(7)) : join(i.cwd, p)))];
      const lines = [
        ...reads.map((file_path, n) => ({ type: "assistant", parent_tool_use_id: null, message: { id: `m${n}`, content: [{ type: "tool_use", name: "Read", input: { file_path } }] } })),
        { type: "result", subtype: "success", result: `Works now: all scenarios. Found: ${spec.found}` },
      ];
      writeFileSync(i.logFile, lines.map((l) => JSON.stringify(l)).join("\n"));
      return { exit: 0, timedOut: false, turnLimit: false, turns: lines.length - 1 };
    };

    it.skipIf(missing.length > 0)("passes a whole run on the correct reference solution: tests, checks, reads, and the grader", () => {
      const k = c();
      const prompts: string[] = [];
      const exec: Exec = (prompt) => {
        prompts.push(prompt);
        return JSON.stringify(k.criteria.map((_, n) => ({ n: n + 1, pass: true, reason: "it does" })));
      };
      const [r] = runLevel2({ root: plugin, role: "frontend", runs: 1, agent: overlayAgent(k), exec, install: noInstall, runsDir: temp("aidw-l2fe-runs-") }, spec.name);
      const x = r!.results[0]!;
      expect(x.error).toBeUndefined();
      expect(x.steps.filter((st) => !st.pass), JSON.stringify(x.steps.filter((st) => !st.pass))).toEqual([]);
      expect(r!.pass).toBe(true);
      expect(prompts).toHaveLength(1);
    }, 600_000);

    extra(c);
  });
}

describe.skipIf(!ready)("the frontend-web fixture's Changes", () => {
  it("every Change is approved and valid with the CLI, and the base branch is main", () => {
    const ids = readdirSync(join(fixture, ".aidw", "changes"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    expect(ids.sort()).toEqual(["book-a-slot", "find-a-person", "invite-a-person", "owners-only-billing"]);
    for (const id of ids) {
      const r = spawnSync("node", [join(plugin, "bin", "aidw"), "approval", "check", id], { cwd: fixture, encoding: "utf8" });
      expect(`${r.stdout}${r.stderr}`, id).toMatch(/approval valid/);
      expect(r.status, id).toBe(0);
      expect(readFileSync(join(fixture, ".aidw", "changes", id, "change.yaml"), "utf8"), id).toMatch(/state: executing[\s\S]*base_branch: main/);
    }
  });

  it("the fixture's own suite and typecheck pass in a fresh copy, with the three new areas absent", () => {
    const prep = prepareCopy(plugin, theCase("people-search"), fixture, nodeModules as string, join(temp("aidw-l2fe-own-"), "project"));
    const run = (cmd: string) => spawnSync("sh", ["-c", cmd], { cwd: prep.project, env: { ...process.env, CI: "1", NO_COLOR: "1" }, encoding: "utf8", timeout: 240_000 });
    const t = run("npm test --silent");
    expect(t.status, `${t.stdout}${t.stderr}`).toBe(0);
    const tc = run("npm run typecheck --silent");
    expect(tc.status, `${tc.stdout}${tc.stderr}`).toBe(0);
    for (const dir of ["people", "team", "billing"]) expect(existsSync(join(prep.project, "src", dir)), dir).toBe(false);
  }, 300_000);
});

// ------------------------------------------------------------------------------------------------ people-search

suite(
  {
    name: "people-search",
    change: "find-a-person",
    capability: "people",
    requirement: "search-people",
    maps: [
      [/with nothing typed/, "nothing-typed-yet"],
      [/each match is listed/, "people-matching-the-text"],
      [/while the answer has not arrived/, "search-waiting"],
      [/an earlier text's slow answer/, "latest-text-wins"],
      [/emptying the box/, "clear-the-box"],
      [/when nobody matches/, "nobody-matches"],
      [/a failed search/, "search-fails"],
    ],
    scripts: ["fetch-waterfalls"],
    reference: "people-search",
    reworded: "people-search-reworded",
    wrong: [
      // copies useFetch: an effect that fetches and sets state, whichever answer comes last
      { overlay: "people-search-stale-answer", fails: [/an earlier text's slow answer/, /emptying the box/], passes: [/each match is listed/, /a failed search/, /with nothing typed/, /when nobody matches/], check: /fetch-waterfalls/, script: "fetch-waterfalls" },
      // ignores an older text by counting only the searches it sends: emptying the box sends none
      { overlay: "people-search-clear-keeps-late-answer", fails: [/emptying the box/], passes: [/an earlier text's slow answer/, /each match is listed/, /a failed search/] },
      // copies NoticesPage: the answer is copied into a second state by an effect; the screen still behaves
      { overlay: "people-search-derived-state", fails: [], passes: [], check: /fetch-waterfalls/, script: "fetch-waterfalls" },
    ],
    outside: "src/ui/Spinner.tsx",
    found: "src/data/useFetch.ts fetches in an effect with no cancel and no ignore flag, so a slow answer to an earlier URL can replace a newer one; I kept my search off it and wrote its own hook.",
  },
  (c) => {
    // a plausible correct solution: fixes the hook inside Touches and uses it
    const FIXED_HOOK = `import { useCallback, useEffect, useState } from "react";
import { getJson } from "../api/client";

/** Loads \`url\` as JSON whenever it changes (nothing for a null url); an older request is cancelled when the url changes. */
export function useFetch<T>(url: string | null): { data: T | null; loading: boolean; failed: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(url !== null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (url === null) return;
    const ac = new AbortController();
    setLoading(true);
    setFailed(false);
    getJson<T>(url, { signal: ac.signal })
      .then((d) => {
        if (ac.signal.aborted) return;
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setFailed(true);
        setLoading(false);
      });
    return () => ac.abort();
  }, [url, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, loading, failed, reload };
}
`;
    const SCREEN = `import { useState } from "react";
import { useFetch } from "../data/useFetch";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import type { Person } from "./api";

export function PeopleSearch() {
  const [text, setText] = useState("");
  const q = text.trim();
  const { data, loading, failed, reload } = useFetch<Person[]>(q ? \`/api/people?q=\${encodeURIComponent(q)}\` : null);
  return (
    <section className="page">
      <h1 className="page__title">People</h1>
      <label>
        Search by name
        <input type="search" value={text} maxLength={50} onChange={(e) => setText(e.target.value)} />
      </label>
      {!q ? (
        <p className="empty">Type a name to search.</p>
      ) : failed ? (
        <div role="alert">
          <p>The search failed.</p>
          <Button onClick={reload}>Retry</Button>
        </div>
      ) : loading || !data ? (
        <Spinner label="Searching…" />
      ) : data.length ? (
        <ul>
          {data.map((p) => (
            <li key={p.id}>
              {p.name} {p.title}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">No one matches “{q}”.</p>
      )}
    </section>
  );
}
`;
    for (const v of ["people-search-request-id", "people-search-typed-cleanup"]) {
      it(`a correct solution of another shape passes the held-out tests and the Touches check: ${v}`, () => {
        const g = graded(c(), "people-search", v);
        const t = g.heldOut();
        expect(t.status, t.out).toBe(0);
        expect(t.out).toMatch(/7 passed/);
        expect(g.check(/nothing outside Touches/)).toMatchObject({ pass: true });
      }, 600_000);
      it.skipIf(scriptMissing("fetch-waterfalls"))(`the fetch-waterfalls check passes ${v}`, () => {
        const g = graded(c(), "people-search", v);
        const r = g.check(/fetch-waterfalls/);
        expect(r.pass, `${v}: ${r.why}`).toBe(true);
      }, 300_000);
    }

    it("LIMIT: a debounce with clearTimeout and no abort, written in the body of useFetch, passes the held-out tests (300 ms is longer than the typing)", () => {
      const g = graded(c(), "people-search", "people-search-debounce-racy");
      const t = g.heldOut();
      expect(t.status, t.out).toBe(0);
    }, 600_000);
    it.skipIf(scriptMissing("fetch-waterfalls"))("the fetch-waterfalls check fails people-search-debounce-racy (it edits the hook's body only)", () => {
      const g = graded(c(), "people-search", "people-search-debounce-racy");
      expect(g.check(/fetch-waterfalls/)).toMatchObject({ pass: false });
    }, 300_000);

    it("a plausible correct solution that fixes useFetch inside Touches and uses it passes the held-out tests, the checks and the notices tests", () => {
      const g = graded(c(), "people-search");
      put(g, "src/data/useFetch.ts", FIXED_HOOK);
      put(g, "src/people/PeopleSearch.tsx", SCREEN);
      const t = g.heldOut();
      expect(t.status, t.out).toBe(0);
      expect(t.out).toMatch(/7 passed/);
      const suite = g.sh("npm test --silent -- tests/notices.test.tsx");
      expect(suite.status, suite.out).toBe(0);
      for (const ch of c().checks.filter((x) => /Touches|typecheck/.test(x.name))) expect(runCheck(ch, g.project, g.env), ch.name).toMatchObject({ pass: true });
      if (!scriptMissing("fetch-waterfalls")) expect(g.check(/fetch-waterfalls/)).toMatchObject({ pass: true });
    }, 600_000);

    it("a solution that waits 200 ms before sending its request still shows only the latest text's people", () => {
      const g = graded(c(), "people-search");
      swap(g, "src/people/usePeopleSearch.ts", "    const ac = new AbortController();\n    setResult({ status: \"searching\" });\n    searchPeople(text, ac.signal)", "    const ac = new AbortController();\n    setResult({ status: \"searching\" });\n    const wait = new Promise((r) => setTimeout(r, 200));\n    wait.then(() => (ac.signal.aborted ? Promise.reject(new Error(\"aborted\")) : searchPeople(text, ac.signal)))");
      const t = g.heldOut();
      expect(t.status, t.out).toBe(0);
    }, 600_000);

    it("a screen with no label on the search box is still found by role, so the held-out tests do not demand a label (the a11y layer's F4 does)", () => {
      const g = graded(c(), "people-search");
      swap(g, "src/people/PeopleSearch.tsx", /<label className="people__field">\s+Search by name\s+<input type="search" value=\{text\} maxLength=\{50\} onChange=\{\(e\) => setText\(e\.target\.value\)\} \/>\s+<\/label>/, '<input type="search" aria-label="Name" value={text} maxLength={50} onChange={(e) => setText(e.target.value)} />');
      const t = g.heldOut();
      expect(t.status, t.out).toBe(0);
    }, 600_000);
  },
);

// ------------------------------------------------------------------------------------------------ invite-form

suite(
  {
    name: "invite-form",
    change: "invite-a-person",
    capability: "team",
    requirement: "invite-a-person",
    maps: [
      [/the form has a Name field/, "the-form"],
      [/an empty name is refused/, "refused-before-sending"],
      [/a name of 81 characters/, "refused-before-sending"],
      [/a valid form sends/, "invitation-sent"],
      [/a 422 for the email/, "field-error-from-the-api"],
      [/two submits/, "send-once"],
      [/a failed request is an alert/, "invitation-fails"],
    ],
    scripts: ["a11y-names", "token-literals"],
    reference: "invite-form",
    reworded: "invite-form-reworded",
    wrong: [
      // copies ContactPage's toast: every error in one place under the form, tied to no field
      { overlay: "invite-form-toast-errors", fails: [/an empty name is refused/, /a name of 81 characters/, /a 422 for the email/], passes: [/the form has a Name field/, /a valid form sends/, /two submits/, /a failed request is an alert/] },
      // no guard against a second submit
      { overlay: "invite-form-sends-twice", fails: [/two submits/], passes: [/the form has a Name field/, /an empty name is refused/, /a valid form sends/, /a 422 for the email/, /a failed request is an alert/] },
      // empties the form after any failure
      { overlay: "invite-form-clears-on-error", fails: [/a 422 for the email/, /a failed request is an alert/], passes: [/a valid form sends/, /two submits/, /an empty name is refused/] },
      // checks nothing before sending: the API's 422 is the only check
      { overlay: "invite-form-server-only", fails: [/an empty name is refused/, /a name of 81 characters/], passes: [/a 422 for the email/, /two submits/, /a valid form sends/, /a failed request is an alert/] },
      // copies ContactPage's placeholder-only fields: nothing for getByLabelText to find
      { overlay: "invite-form-placeholders", fails: [/the form has a Name field/, /an empty name is refused/, /a valid form sends/, /a 422 for the email/], passes: [], check: /a11y-names/, script: "a11y-names" },
    ],
    outside: "src/contact/ContactPage.tsx",
    found: "src/contact/ContactPage.tsx shows every error in one toast, takes its fields by placeholder only and can be submitted twice; I did not copy that and left it as it is.",
  },
  (c) => {
    it("a form whose name input has maxLength 80 cannot type 81 characters, sends 80, and passes (the held-out test allows it)", () => {
      const g = graded(c(), "invite-form");
      swap(g, "src/team/InviteForm.tsx", '<input id="invite-name" value={name}', '<input id="invite-name" maxLength={80} value={name}');
      const t = g.heldOut();
      expect(t.status, t.out).toBe(0);
      expect(t.out).toMatch(/7 passed/);
    }, 600_000);

    it("a form that marks a client-refused name aria-invalid as well as describing it passes; one that only uses the native required attribute does not", () => {
      const ok = graded(c(), "invite-form");
      expect(ok.heldOut().status).toBe(0);
      const native = graded(c(), "invite-form");
      swap(native, "src/team/InviteForm.tsx", " noValidate>", ">");
      swap(native, "src/team/InviteForm.tsx", '<input id="invite-name" value={name}', '<input id="invite-name" required value={name}');
      swap(native, "src/team/InviteForm.tsx", /    const found = check\(name, email\);\n    setErrors\(found\);\n    if \(found\.name \|\| found\.email\) return;\n/, "");
      const t = native.heldOut();
      expect(t.status).not.toBe(0);
      expect(failedTests(t.out).join("\n"), t.out).toMatch(/an empty name is refused/);
    }, 600_000);

    it.skipIf(scriptMissing("token-literals"))("the token check fails a literal in the form's styles and passes the correct reference", () => {
      const g = graded(c(), "invite-form");
      expect(g.check(/token-literals/)).toMatchObject({ pass: true });
      const css = join(g.project, "src", "team", "team.css");
      writeFileSync(css, readFileSync(css, "utf8") + "\n.team__error { padding: 7px; }\n");
      expect(g.check(/token-literals/)).toMatchObject({ pass: false });
    }, 300_000);
  },
);

// ------------------------------------------------------------------------------------------------ billing-page-guard

suite(
  {
    name: "billing-page-guard",
    change: "owners-only-billing",
    capability: "billing",
    requirement: "billing-for-owners",
    maps: [
      [/the session answer has not arrived/, "checking-access"],
      [/an owner sees the plan/, "billing-for-an-owner"],
      [/an owner is an owner whatever/, "billing-for-an-owner"],
      [/signed out, the visitor/, "signed-out"],
      [/a member sees that the page/, "members-see-an-owners-only-page"],
      [/Stripe test key sees Test mode/, "test-mode-badge"],
    ],
    scripts: ["public-env-scan", "token-literals"],
    reference: "billing-page-guard",
    reworded: "billing-page-guard-reworded",
    wrong: [
      // hides the link in the nav (Layout does) and guards nothing: the route shows the page to anyone
      { overlay: "billing-page-guard-nav-only", fails: [/the session answer has not arrived/, /signed out, the visitor/, /a member sees that the page/], passes: [/an owner sees the plan/, /Test mode/] },
      // decides from localStorage.role, as the nav does
      { overlay: "billing-page-guard-local-storage", fails: [/a member sees that the page/, /an owner is an owner whatever/], passes: [/signed out, the visitor/] },
      // the page requests the billing beside the check and only hides it
      { overlay: "billing-page-guard-fetches-first", fails: [/the session answer has not arrived/, /signed out, the visitor/, /a member sees that the page/], passes: [/an owner sees the plan/, /Test mode/] },
      // redirects to /login without the page to come back to
      { overlay: "billing-page-guard-login-without-next", fails: [/signed out, the visitor/], passes: [/the session answer has not arrived/, /a member sees that the page/, /an owner sees the plan/, /Test mode/] },
      // reads a secret under a public name
      { overlay: "billing-page-guard-secret-env", fails: [/Stripe test key sees Test mode/], passes: [/an owner sees the plan/, /a member sees that the page/], check: /public-env-scan/, script: "public-env-scan" },
      // reads the API's own secret name in the page
      { overlay: "billing-page-guard-unprefixed-secret", fails: [/Stripe test key sees Test mode/], passes: [/an owner sees the plan/, /a member sees that the page/], check: /public-env-scan/, script: "public-env-scan" },
    ],
    outside: "src/Layout.tsx",
    found: "src/Layout.tsx hides the Billing link by localStorage.role, which the browser's user can set; the guard of /billing does not read it, and the API refuses billing to a member.",
  },
  (c) => {
    for (const v of ["go-navigate", "loader", "nav-links", "catch-all"]) {
      it(`a correct guard of another shape passes the held-out tests: billing-page-guard-${v}`, () => {
        const g = graded(c(), "billing-page-guard", `billing-page-guard-${v}`);
        const t = g.heldOut();
        expect(t.status, t.out).toBe(0);
        expect(t.out).toMatch(/6 passed/);
      }, 600_000);
    }

    it("a nav with a Sign out navigate('/') and no guard on /billing fails the member, signed-out and checking tests", () => {
      const g = graded(c(), "billing-page-guard", "billing-page-guard-signout-nav-only");
      const t = g.heldOut();
      expect(t.status).not.toBe(0);
      const failed = failedTests(t.out).join("\n");
      for (const f of [/a member sees that the page/, /signed out, the visitor/, /the session answer has not arrived/]) expect(failed, t.out).toMatch(f);
    }, 600_000);
    it("no route-guard-inventory check gates the case: it failed a correct session whose loader asks the session and whose page decides", () => {
      const names = c().checks.map((ch) => ch.name).join("\n");
      expect(names).not.toMatch(/route-guard-inventory/);
      expect(names).toMatch(/public-env-scan/);
    });

    it("a guard written as a layout route with the guard around an Outlet passes the held-out tests", () => {
      const g = graded(c(), "billing-page-guard");
      put(
        g,
        "src/billing/OwnerLayout.tsx",
        `import { Outlet } from "react-router";
import { RequireOwner } from "./RequireOwner";

/** A layout route: whatever is nested under it is for owners. */
export function OwnerLayout() {
  return (
    <RequireOwner>
      <Outlet />
    </RequireOwner>
  );
}
`,
      );
      swap(g, "src/routes.tsx", /      \{\n        path: "billing",\n        element: \(\n          <RequireOwner>\n            <BillingPage \/>\n          <\/RequireOwner>\n        \),\n      \},/, '      { element: <OwnerLayout />, children: [{ path: "billing", element: <BillingPage /> }] },');
      swap(g, "src/routes.tsx", 'import { RequireOwner } from "./billing/RequireOwner";', 'import { OwnerLayout } from "./billing/OwnerLayout";');
      const t = g.heldOut();
      expect(t.status, t.out).toBe(0);
      expect(t.out).toMatch(/6 passed/);
    }, 600_000);

    it("a billing page that formats the balance by hand as 129.00 EUR still passes the held-out tests (money is asserted loosely)", () => {
      const g = graded(c(), "billing-page-guard");
      swap(g, "src/billing/BillingPage.tsx", /const money = .*\n/, "const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency}`;\n");
      const t = g.heldOut();
      expect(t.status, t.out).toBe(0);
    }, 600_000);

    it("a billing page that reads the key at module load passes too, because the held-out file sets it before the app loads", () => {
      const g = graded(c(), "billing-page-guard");
      swap(g, "src/billing/BillingPage.tsx", /const inTestMode = .*\n/, 'const TEST_KEY = String(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? "").startsWith("pk_test_");\nconst inTestMode = (): boolean => TEST_KEY;\n');
      const t = g.heldOut();
      expect(t.status, t.out).toBe(0);
    }, 600_000);
  },
);
