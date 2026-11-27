import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseTokens } from "../src/design.js";
import { Diags } from "../src/diag.js";
import type { Exec } from "../src/evalrun.js";
import { ensureFixturePackages, fixturesDir, loadLevel2Cases, prepareCopy, removeTree, runCheck, runLevel2, type AgentRunner, type Level2Case } from "../src/evallevel2.js";

/**
 * The frontend-web fixture (Vite, React 19, Vitest with jsdom, Testing Library, MSW) and the frontend pilot level 2 case
 * book-a-slot-screen, with no model: the fixture's own suite passes, its tokens.css is its tokens.yaml, the brief keeps
 * the tokens and drops the screenshot lines, the correct reference solution passes the held-out tests and the checks,
 * each wrong one (a copy of one planted defect) fails the held-out test meant for it, and the untouched fixture fails.
 * Needs the fixture's packages in the cache (AIDW_FIXTURE_CACHE) and the built plugin bin; skipped without them. The
 * checks that run the Role's a11y-names and token-literals scripts run only once those scripts are in the plugin.
 */
const repo = join(__dirname, "..");
const plugin = join(repo, "plugins", "aidw");
const fixture = join(fixturesDir(plugin), "frontend-web");
const reference = join(repo, "evals", "level2-reference");
const CASE = "book-a-slot-screen";
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
const SCRIPTS = { "a11y-names": /a11y-names/, "token-literals": /token-literals/ };
const scriptMissing = (name: string) => !existsSync(join(plugin, "roles", "frontend", "scripts", `${name}.mjs`));
const missingScripts = Object.keys(SCRIPTS).filter(scriptMissing);
/** a check that runs a script not yet in the plugin (written on another branch) */
const waitsForScript = (checkName: string) => missingScripts.some((s) => SCRIPTS[s as keyof typeof SCRIPTS].test(checkName));

const temps: string[] = [];
afterAll(() => temps.forEach(removeTree));
const temp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  temps.push(d);
  return d;
};
const pilot = (): Level2Case => loadLevel2Cases(plugin, "frontend").cases.find((c) => c.name === CASE)!;

/** A prepared copy of the case's Change with the overlays laid over it (as an Agent would leave it), then the held-out files. */
function graded(c: Level2Case, ...overlays: string[]) {
  const prep = prepareCopy(plugin, c, fixture, nodeModules as string, join(temp("aidw-l2fe-"), "project"));
  for (const o of overlays) cpSync(join(reference, o), prep.project, { recursive: true });
  return withHeldOut(c, prep);
}

/** A prepared copy with nothing laid over it: the fixture as the session starts from it. */
function untouched(c: Level2Case) {
  return commands(c, prepareCopy(plugin, c, fixture, nodeModules as string, join(temp("aidw-l2fe-"), "project")));
}

function withHeldOut(c: Level2Case, prep: ReturnType<typeof prepareCopy>) {
  cpSync(join(plugin, c.dir, "held-out"), prep.project, { recursive: true });
  return commands(c, prep);
}

function commands(c: Level2Case, prep: ReturnType<typeof prepareCopy>) {
  const env = { ...process.env, PATH: [join(plugin, "bin"), process.env.PATH].join(":"), AIDW_BASE: prep.base, AIDW_PROJECT: prep.project, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" };
  const check = (name: RegExp) => runCheck(c.checks.find((ch) => name.test(ch.name))!, prep.project, env);
  const sh = (cmd: string) => {
    const r = spawnSync("sh", ["-c", cmd], { cwd: prep.project, env, encoding: "utf8", timeout: 240_000 });
    return { status: r.status, out: `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "") };
  };
  const heldOut = () => sh(`npm test --silent -- ${c.heldOut.join(" ")}`);
  return { prep, project: prep.project, env, check, sh, heldOut };
}

/** The held-out tests a run reports as failed, by the words of their names. */
const failedTests = (out: string) => [...new Set([...out.matchAll(/(?:×|FAIL) .*?> ([^\n]+)$/gm)].map((m) => m[1]!.split(" > ").pop()!.replace(/\s+\d+ms\s*$/, "").trim()))];

describe("the frontend-web fixture: tokens", () => {
  it("src/styles/tokens.css holds every token of tokens.yaml as --<name>, dark values under prefers-color-scheme: dark", () => {
    const d = new Diags();
    const tokens = parseTokens(readFileSync(join(fixture, ".aidw", "design", "tokens.yaml"), "utf8"), "tokens.yaml", d);
    expect(d.errors).toEqual([]);
    const css = readFileSync(join(fixture, "src", "styles", "tokens.css"), "utf8");
    const [light, dark] = css.split("@media (prefers-color-scheme: dark)");
    expect(tokens.length).toBeGreaterThan(10);
    for (const t of tokens) {
      expect(light).toContain(`--${t.name}: ${t.value};`);
      if (t.dark) expect(dark).toContain(`--${t.name}: ${t.dark};`);
    }
    expect([...light!.matchAll(/^\s+--[a-z0-9-]+:/gm)]).toHaveLength(tokens.length);
  });
});

describe.skipIf(!ready)(`the frontend-web fixture and level 2 case ${CASE} (cached packages)`, () => {
  it("loads, on the fixture's Change, with screenshots off and the test harness restored", () => {
    const { cases, diags } = loadLevel2Cases(plugin, "frontend");
    expect(diags.errors).toEqual([]);
    const c = cases.find((x) => x.name === CASE)!;
    expect(c).toMatchObject({ fixture: "frontend-web", change: "book-a-slot", task: "T01", screenshots: false });
    expect(c.restore).toEqual(expect.arrayContaining(["tests/setup.ts", "tests/msw/handlers.ts"]));
    expect(c.heldOut).toEqual(["tests/held-out/book-a-slot.test.tsx"]);
    expect(c.checks).toHaveLength(6);
    expect(c.criteria).toHaveLength(1);
  });

  it("passes its own tests and typecheck in a fresh copy", () => {
    const g = untouched(pilot());
    const t = g.sh("npm test --silent");
    expect(t.status, t.out).toBe(0);
    const tc = g.sh("npm run typecheck --silent");
    expect(tc.status, tc.out).toBe(0);
  }, 300_000);

  it("briefs the task with the design tokens and without the screenshot lines; without the key the lines are there", () => {
    const c = pilot();
    const off = prepareCopy(plugin, c, fixture, nodeModules as string, join(temp("aidw-l2fe-brief-"), "project"));
    expect(off.briefText).toMatch(/## Design tokens \(approved; binding for UI\)/);
    expect(off.briefText).toMatch(/\| `color-accent` \| color \| `#0b63c4` \|/);
    expect(off.briefText).toMatch(/- \*\*Design\*\*: style through the tokens below/);
    expect(off.briefText).not.toMatch(/Screenshots\*\*|Playwright|PNG/);
    expect(readFileSync(off.brief, "utf8")).toBe(off.briefText);
    const on = prepareCopy(plugin, { ...c, screenshots: true }, fixture, nodeModules as string, join(temp("aidw-l2fe-brief-"), "project"));
    expect(on.briefText).toMatch(/- \*\*Screenshots\*\*: when it works, save at most 6 PNG/);
    expect(on.briefText).toMatch(/- Take screenshots with Playwright/);
  });

  it("the correct reference solution passes the held-out tests and every check of checks.yaml that can run", () => {
    const c = pilot();
    const g = graded(c, CASE);
    const t = g.heldOut();
    expect(t.status, t.out).toBe(0);
    expect(t.out).toMatch(/7 passed/);
    const results = c.checks.filter((ch) => !waitsForScript(ch.name)).map((ch) => [ch.name, runCheck(ch, g.project, g.env)] as const);
    expect(results.length).toBe(c.checks.length - missingScripts.length);
    expect(results.filter(([, r]) => !r.pass)).toEqual([]);
  }, 600_000);

  const WRONG: { overlay: string; fails: RegExp[]; passes: RegExp[] }[] = [
    // copies DayList: a <div onClick> named by its raw icon key is no button, so every test that picks a slot fails
    { overlay: `${CASE}-div-slots`, fails: [/every open slot is a button named by its time/, /picking a slot opens a dialog/, /Escape closes the dialog/], passes: [/a day with no slots/] },
    // trusts the shared Dialog: focus stays on <body> after Escape
    // names the slot's icon by its raw key: the button is still named by its time, but the name holds "icon-clock"
    { overlay: `${CASE}-icon-key-name`, fails: [/every open slot is a button named by its time/], passes: [/picking a slot opens a dialog/, /Escape closes the dialog/, /confirming sends the booking/, /a failed load is an alert/] },
    { overlay: `${CASE}-no-focus-return`, fails: [/Escape closes the dialog without booking and puts focus back on the slot/], passes: [/picking a slot opens a dialog/, /a failed load is an alert/] },
    // copies useLoad: a failed load becomes the empty list
    { overlay: `${CASE}-empty-on-error`, fails: [/a failed load is an alert with a Retry/], passes: [/Escape closes the dialog/, /a day with no slots/] },
  ];
  for (const w of WRONG) {
    it(`the wrong solution ${w.overlay} fails the held-out test meant for it, and only the tests its flaw breaks`, () => {
      const g = graded(pilot(), CASE, w.overlay);
      const t = g.heldOut();
      expect(t.status).not.toBe(0);
      const failed = failedTests(t.out).join("\n");
      for (const f of w.fails) expect(failed, t.out).toMatch(f);
      for (const p of w.passes) expect(failed, t.out).not.toMatch(p);
    }, 600_000);
  }

  it("a reference that words the confirm button and the failure alert differently still passes the held-out tests (7 of 7)", () => {
    const g = graded(pilot(), CASE, `${CASE}-reworded`);
    const t = g.heldOut();
    expect(t.status, t.out).toBe(0);
    expect(t.out).toMatch(/7 passed/);
  }, 600_000);

  it.skipIf(missingScripts.includes("a11y-names"))("the a11y-names check fails the div-slots solution and passes the correct one", () => {
    const bad = graded(pilot(), CASE, `${CASE}-div-slots`);
    expect(bad.check(/a11y-names/)).toMatchObject({ pass: false, why: expect.stringMatching(/div-click|no-name/) });
    expect(graded(pilot(), CASE).check(/a11y-names/)).toMatchObject({ pass: true });
  }, 300_000);

  it.skipIf(missingScripts.includes("token-literals"))("the token check fails a radius, a shadow, a font and a z-index literal, not only colors and lengths", () => {
    const g = graded(pilot(), CASE);
    const css = join(g.project, "src", "booking", "booking.css");
    writeFileSync(css, readFileSync(css, "utf8") + `\n.slot { border-radius: 7px; box-shadow: 0 2px 9px rgba(3, 4, 5, 0.31); font-family: "Papyrus", serif; z-index: 77; }\n`);
    // the check's own output, whole (a failed check's reason keeps only its tail)
    const r = g.sh(pilot().checks.find((ch) => /token-literals/.test(ch.name))!.run);
    expect(r.status).not.toBe(0);
    for (const kind of ["radius", "shadow", "font", "z-index"]) expect(r.out).toContain(`"kind":"${kind}"`);
  }, 300_000);

  it("the untouched fixture fails the held-out tests (no route yet) and the scenario-id check", () => {
    const g = graded(pilot());
    const t = g.heldOut();
    expect(t.status).not.toBe(0);
    expect(failedTests(t.out), t.out).toHaveLength(7);
    expect(g.check(/scenario id/)).toMatchObject({ pass: false, why: expect.stringMatching(/no test names /) });
  }, 600_000);

  it("the Touches check fails a solution that fixes the shared Dialog in src/ui/", () => {
    const g = graded(pilot(), CASE);
    writeFileSync(join(g.project, "src", "ui", "Dialog.tsx"), readFileSync(join(g.project, "src", "ui", "Dialog.tsx"), "utf8") + "\n// fixed\n");
    expect(g.check(/nothing outside Touches/)).toMatchObject({ pass: false });
  }, 300_000);

  /** A session that lays the reference solution over the copy and reads the case's must_read files. */
  const overlayAgent =
    (c: Level2Case): AgentRunner =>
    (i) => {
      cpSync(join(reference, CASE), i.cwd, { recursive: true });
      const brief = i.prompt.replace(/^Task brief: (.*)\. Read it.*$/, "$1");
      const reads = [brief, ...c.mustRead.map((p) => (p.startsWith("plugin:") ? join(i.pluginRoot, p.slice(7)) : join(i.cwd, p)))];
      const lines = [
        ...reads.map((file_path, n) => ({ type: "assistant", parent_tool_use_id: null, message: { id: `m${n}`, content: [{ type: "tool_use", name: "Read", input: { file_path } }] } })),
        { type: "result", subtype: "success", result: "Works now: all scenarios. Found: src/ui/Dialog.tsx does not return focus to the control that opened it; the screen does it itself." },
      ];
      writeFileSync(i.logFile, lines.map((l) => JSON.stringify(l)).join("\n"));
      return { exit: 0, timedOut: false, turnLimit: false, turns: lines.length - 1 };
    };

  it.skipIf(missingScripts.includes("token-literals"))("a session that adds a token for its literal still fails the token check: the tokens file is restored before grading", () => {
    const c = pilot();
    expect(c.restore).toContain(".aidw/design/tokens.yaml");
    const cheat: AgentRunner = (i) => {
      cpSync(join(reference, CASE), i.cwd, { recursive: true });
      const css = join(i.cwd, "src", "booking", "booking.css");
      writeFileSync(css, readFileSync(css, "utf8") + "\n.slot {\n  min-width: 73px;\n}\n");
      const tokens = join(i.cwd, ".aidw", "design", "tokens.yaml");
      writeFileSync(tokens, readFileSync(tokens, "utf8") + "\n  - name: size-slot-min\n    kind: size\n    value: 73px\n    use: the least width of a slot button\n");
      writeFileSync(i.logFile, JSON.stringify({ type: "result", subtype: "success", result: "done" }));
      return { exit: 0, timedOut: false, turnLimit: false, turns: 1 };
    };
    const [r] = runLevel2({ root: plugin, role: "frontend", runs: 1, agent: cheat, exec: () => "[]", install: noInstall, runsDir: temp("aidw-l2fe-runs-") }, CASE);
    const checks = r!.results[0]!.steps.find((st) => st.step === "checks")!;
    expect(checks.failed.join("\n")).toMatch(/no literal that is not a token.*73px/s);
    // and editing the tokens file is itself outside Touches
    expect(checks.failed.join("\n")).toMatch(/nothing outside Touches.*\.aidw\/design\/tokens\.yaml/s);
  }, 600_000);

  it("the Touches check allows .aidw/run and .aidw/changes, and fails on any other file of .aidw/", () => {
    const g = graded(pilot(), CASE);
    const list = (files: string[]) => {
      const f = join(g.project, "..", "changed.txt");
      writeFileSync(f, files.join("\n") + "\n");
      return { ...g.env, AIDW_CHANGED: f };
    };
    const ch = pilot().checks.find((x) => /nothing outside Touches/.test(x.name))!;
    expect(runCheck(ch, g.project, list(["src/booking/BookSlotScreen.tsx", ".aidw/run/report-T01.md", ".aidw/changes/book-a-slot/tasks.yaml"]))).toMatchObject({ pass: true });
    for (const f of [".aidw/design/tokens.yaml", ".aidw/constitution.md"]) expect(runCheck(ch, g.project, list([f]))).toMatchObject({ pass: false });
  }, 300_000);

  it.skipIf(missingScripts.length > 0)("passes a whole run on the correct reference solution: tests, checks, reads, and the grader", () => {
    const c = pilot();
    const prompts: string[] = [];
    const exec: Exec = (prompt) => {
      prompts.push(prompt);
      return JSON.stringify(c.criteria.map((_, n) => ({ n: n + 1, pass: true, reason: "it does" })));
    };
    const [r] = runLevel2({ root: plugin, role: "frontend", runs: 1, agent: overlayAgent(c), exec, install: noInstall, runsDir: temp("aidw-l2fe-runs-") }, CASE);
    const x = r!.results[0]!;
    expect(x.error).toBeUndefined();
    expect(x.steps.filter((st) => !st.pass), JSON.stringify(x.steps.filter((st) => !st.pass))).toEqual([]);
    expect(r!.pass).toBe(true);
    expect(prompts).toHaveLength(1);
  }, 600_000);
});
