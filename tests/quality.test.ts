import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { decide, type HookInput } from "../src/gate.js";
import { parseQuality } from "../src/quality.js";
import { ANALYSIS_MD, TOKENS_YAML, MAIN_SPEC, QUALITY_YAML, REQ, tempProject, write } from "./fixtures.js";

const ID = "2026-11-08-booking";
const SCENARIO = "booking/reschedule-appointment/reschedule-appointment-works";

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}

// Layer commands are approved project commands; here small node scripts driven by marker files.
const Q = (extra = "") => `layers:
  - name: code
    run: ["node check.js code-ok"]
  - name: unit
    setup: ["node check.js setup-ok"]
    run: ["node check.js unit-ok"]
  - name: e2e
    run: ["node check.js e2e-ok"]
deploy:
  target: preview
  command: vercel deploy --yes
  smoke: ["node smoke.js"]
permissions: [vercel-preview]
${extra}`;

const TASKS = `tasks:
  - id: T01
    title: Reschedule an appointment
    role: fullstack-engineer
    type: feat
    scenarios: [${SCENARIO}]
    touches: ["lib/**", "tests/**"]
    verify: ['node -e "process.exit(0)"']
    status: pending
`;

function project(quality = Q()): string {
  const root = tempProject();
  cli(root, "init");
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  cli(root, "change", "new", ID);
  const c = `.aidw/changes/${ID}`;
  write(root, `${c}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `${c}/tasks.yaml`, TASKS);
  write(root, `${c}/quality.yaml`, quality);
  write(root, `${c}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  write(root, "check.js", "process.exit(require('fs').existsSync(process.argv[2]) ? 0 : (console.log('missing ' + process.argv[2]), 1));\n");
  write(root, "smoke.js", "process.exit(/^https:\\/\\/demo-[a-z]+\\.vercel\\.app$/.test(process.env.AIDW_DEPLOY_URL || '') ? 0 : 1);\n");
  for (const f of ["code-ok", "setup-ok", "e2e-ok"]) write(root, f, "");
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).err).toBe("");
  expect(cli(root, "approve", ID).code).toBe(0);
  expect(cli(root, "transition", ID, "executing").code).toBe(0);
  return root;
}

/** Runs one task through implement -> checkpoint -> review (the S3 loop, played by the test). */
function completeTask(root: string, task: string, beforeCheckpoint?: () => void) {
  expect(cli(root, "task", "start", task).code).toBe(0);
  beforeCheckpoint?.();
  expect(cli(root, "checkpoint", task).out).toMatch(/^PASS/);
  expect(cli(root, "review", task, "pass").code).toBe(0);
}

const tasks = (root: string) => (YAML.parse(readFileSync(join(root, ".aidw/changes", ID, "tasks.yaml"), "utf8")) as { tasks: Record<string, unknown>[] }).tasks;
const state = (root: string) => cli(root, "status", "--json").json().changes[0].state;

/** A fake `vercel` on PATH that prints deploy output like the real CLI. */
function fakeVercel(url: string | null, exit = 0): () => void {
  const dir = tempProject();
  const bin = write(dir, "vercel", `#!/bin/sh\necho "Inspect: https://vercel.com/team/app/abc"\n${url ? `echo "Preview: ${url}"\n` : ""}exit ${exit}\n`);
  chmodSync(bin, 0o755);
  const before = process.env.PATH;
  process.env.PATH = `${dir}:${before}`;
  return () => {
    process.env.PATH = before;
  };
}

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

describe("quality.yaml", () => {
  const errors = (text: string) => parseQuality(text, "q").diags.errors.map((d) => d.message);

  it("accepts the fixture and warns about missing standard layers", () => {
    expect(errors(QUALITY_YAML)).toEqual([]);
    const d = parseQuality("layers:\n  - name: unit\n    run: [x]\n", "q").diags;
    expect(d.warnings.map((w) => w.message)).toEqual([
      'no "code" layer; say in analysis.md why this project does not need it',
      'no "e2e" layer; say in analysis.md why this project does not need it',
    ]);
  });

  it("never automates production or unrecognized deploys", () => {
    expect(errors("layers:\n  - name: code\n    run: [x]\ndeploy:\n  target: production\n")).toContain(
      "deploy.target must be one of none, local, preview (production is tier 3 and never automatic)",
    );
    expect(errors(`layers:\n  - name: code\n    run: [x]\ndeploy:\n  target: preview\n  command: vercel deploy --prod\npermissions: [vercel-preview]\n`)).toContain(
      "deploy.command changes Vercel production, domains or deletes deployments: tier 3 is never automatic",
    );
    expect(errors(`layers:\n  - name: code\n    run: [x]\ndeploy:\n  target: preview\n  command: ./deploy.sh\n`)).toContain(
      "deploy.command must be a recognized preview deploy (vercel deploy, netlify deploy) because it runs without asking",
    );
    expect(errors(`layers:\n  - name: code\n    run: [x]\ndeploy:\n  target: preview\n  command: pnpm dlx vercel deploy --yes\n`)).toContain(
      'deploy.command needs "vercel-preview" in permissions',
    );
    expect(errors("layers: []\npermissions: [aws-prod]\n")).toEqual([
      'expected a non-empty "layers:" list',
      'unknown tier-2 resource "aws-prod" (known: vercel-preview, netlify-preview, supabase-dev)',
    ]);
  });

  it("is part of the approved package and must match ## Permissions", () => {
    const root = project();
    expect(cli(root, "approval", "check", ID, "--json").json().files).toContain(`.aidw/changes/${ID}/quality.yaml`);
    const other = tempProject();
    cli(other, "init");
    cli(other, "change", "new", "x");
    write(other, ".aidw/changes/x/analysis.md", ANALYSIS_MD.replace("`vercel-preview`: ", ""));
    write(other, ".aidw/changes/x/quality.yaml", QUALITY_YAML);
    write(other, ".aidw/changes/x/tasks.yaml", TASKS.replace(`scenarios: [${SCENARIO}]`, "scenarios: []"));
    const errs = cli(other, "analyze", "x", "--json").json().errors.map((e: { message: string }) => e.message);
    expect(errs).toContain('"## Permissions" must name the tier-2 resource "vercel-preview" that quality.yaml requests');
  });
});

describe("verify -> fix -> deploy (exit criterion [6])", () => {
  it("turns a failing layer into a fix task, re-verifies on the new code, deploys and delivers", () => {
    const root = project();
    expect(cli(root, "transition", ID, "verifying").err).toMatch(/needs every task done; open: T01 \(pending\)/);
    completeTask(root, "T01", () => write(root, "tests/booking.test.ts", `test("${SCENARIO}: works", () => {})\n`));
    expect(cli(root, "next", "--json").json().action).toBe("complete");
    expect(cli(root, "transition", ID, "verifying").code).toBe(0);
    expect(cli(root, "transition", ID, "converging").err).toMatch(/needs every quality layer passing.*pending: code, unit, e2e/);

    // unit fails: a fix task is added and the change goes back to executing
    const v1 = cli(root, "verify", "--json");
    expect(v1.code).toBe(1);
    expect(v1.json()).toMatchObject({ ok: false, failed: "unit", fixTask: "Q01" });
    expect(v1.json().layers.map((l: { status: string }) => l.status)).toEqual(["pass", "fail", "skipped"]);
    expect(state(root)).toBe("executing");
    const q = tasks(root).find((t) => t.id === "Q01");
    expect(q).toMatchObject({ origin: "quality", layer: "unit", touches: ["**"], verify: ["node check.js setup-ok", "node check.js unit-ok"] });
    expect(String(q?.problem)).toMatch(/Quality layer "unit" failed: `node check.js unit-ok` exited 1[\s\S]*missing unit-ok/);
    expect(cli(root, "approval", "check", ID).code).toBe(0); // added tasks are not drift

    // the fix goes through the normal loop with a brief that carries the problem
    expect(cli(root, "next", "--json").json()).toMatchObject({ action: "implement", task: "Q01" });
    cli(root, "task", "start", "Q01");
    const brief = readFileSync(cli(root, "brief", "Q01").out.trim(), "utf8");
    expect(brief).toMatch(/## Problem to fix[\s\S]*missing unit-ok/);
    expect(brief).toMatch(/obra\/systematic-debugging/);
    write(root, "unit-ok", "");
    expect(cli(root, "checkpoint", "Q01").code).toBe(0);
    cli(root, "review", "Q01", "pass");
    expect(cli(root, "transition", ID, "verifying").code).toBe(0);

    // code changed after the first run, so every layer runs again
    const v2 = cli(root, "verify", "--json").json();
    expect(v2).toMatchObject({ ok: true, summary: "all quality layers pass" });
    expect(v2.layers.map((l: { status: string }) => l.status)).toEqual(["pass", "pass", "pass"]);
    // a second call has nothing left to run
    expect(cli(root, "verify", "--json").json().layers.map((l: { status: string }) => l.status)).toEqual(["skipped", "skipped", "skipped"]);

    expect(cli(root, "transition", ID, "converging").code).toBe(0);
    expect(cli(root, "transition", ID, "deploying").err).toMatch(/needs a passing converge on the current code: run `aidw converge` first/);
    expect(cli(root, "converge").out).toMatch(/^PASS \(presence\): all 1 scenario\(s\) have a passing test/);
    expect(cli(root, "transition", ID, "deploying").code).toBe(0);
    expect(cli(root, "transition", ID, "delivered").err).toMatch(/needs a successful `aidw deploy`/);

    restore = fakeVercel(null);
    const bad = cli(root, "deploy");
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/DEPLOY FAILED: no https URL in the deploy output/);
    restore();

    restore = fakeVercel("https://demo-booking.vercel.app");
    const ok = cli(root, "deploy", "--json");
    expect(ok.code).toBe(0);
    expect(ok.json()).toMatchObject({ ok: true, url: "https://demo-booking.vercel.app", target: "preview" });
    expect(cli(root, "transition", ID, "delivered").code).toBe(0);
    const ev = JSON.parse(readFileSync(join(root, ".aidw/changes", ID, "evidence/deploy.json"), "utf8"));
    expect(ev.runs.map((r: { ok: boolean }) => r.ok)).toEqual([false, true]);
  });

  it("escalates when a layer keeps failing past max_fix_rounds", () => {
    const root = project(Q("max_fix_rounds: 1\n"));
    completeTask(root, "T01", () => write(root, "tests/booking.test.ts", `test("${SCENARIO}: works", () => {})\n`));
    write(root, "unit-ok", "");
    rmSync(join(root, "e2e-ok"));
    cli(root, "transition", ID, "verifying");
    expect(cli(root, "verify", "--json").json()).toMatchObject({ failed: "e2e", fixTask: "Q01" });
    // the fix passes its own checkpoint, but the layer breaks again on the next verify
    completeTask(root, "Q01", () => write(root, "e2e-ok", ""));
    rmSync(join(root, "e2e-ok"));
    cli(root, "transition", ID, "verifying");
    const v = cli(root, "verify", "--json").json();
    expect(v).toMatchObject({ ok: false, failed: "e2e", escalated: true });
    expect(v.summary).toMatch(/fix rounds exhausted \(1\/1\): escalated/);
    expect(state(root)).toBe("escalated");
    expect(tasks(root).filter((t) => t.origin === "quality")).toHaveLength(1);
  });

  it("records target none without deploying", () => {
    const root = project(Q().replace(/deploy:[\s\S]*permissions: \[vercel-preview\]\n/, "deploy:\n  target: none\n"));
    completeTask(root, "T01", () => write(root, "tests/booking.test.ts", `test("${SCENARIO}: works", () => {})\n`));
    write(root, "unit-ok", "");
    for (const s of ["verifying"]) cli(root, "transition", ID, s);
    expect(cli(root, "verify").code).toBe(0);
    expect(cli(root, "transition", ID, "converging").code).toBe(0);
    expect(cli(root, "converge").code).toBe(0);
    expect(cli(root, "transition", ID, "deploying").code).toBe(0);
    expect(cli(root, "deploy").out).toMatch(/deploy skipped: target "none"/);
    expect(cli(root, "transition", ID, "delivered").code).toBe(0);
  });

  it("commits only .aidw/ evidence when delivered", () => {
    const root = project(Q().replace(/deploy:[\s\S]*permissions: \[vercel-preview\]\n/, "deploy:\n  target: none\n"));
    const g = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
    g("init", "-q");
    g("config", "user.email", "t@t");
    g("config", "user.name", "t");
    g("add", "-A");
    g("commit", "-qm", "base");
    completeTask(root, "T01", () => write(root, "tests/booking.test.ts", `test("${SCENARIO}: works", () => {})\n`));
    write(root, "unit-ok", "");
    g("add", "unit-ok");
    g("commit", "-qm", "marker");
    write(root, "notes-of-the-user.md", "not ours\n");
    for (const s of ["verifying"]) cli(root, "transition", ID, s);
    expect(cli(root, "verify").code).toBe(0);
    cli(root, "transition", ID, "converging");
    cli(root, "converge");
    cli(root, "transition", ID, "deploying");
    cli(root, "deploy");
    expect(cli(root, "transition", ID, "delivered", "--json").json().commit).toMatch(/^[0-9a-f]{40}$/);
    expect(g("log", "-1", "--format=%s").trim()).toBe(`chore(aidw): ${ID} delivered`);
    expect(g("show", "--name-only", "--format=", "HEAD")).toContain("evidence/deploy.json");
    expect(g("status", "--porcelain").trim()).toBe("?? notes-of-the-user.md");
  });
});

describe("tier-2 allowlist in the gate", () => {
  const hook = (cwd: string, command: string, agent_type?: string): HookInput => ({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
    cwd,
    ...(agent_type ? { agent_type } : {}),
  });

  it("allows an approved preview deploy without asking, and only that", () => {
    const root = project();
    const d = (c: string, a?: string) => decide(hook(root, c, a), {})?.decision ?? "none";
    expect(d("vercel deploy --yes")).toBe("allow");
    expect(d("pnpm dlx vercel deploy --yes")).toBe("allow");
    expect(d("npx vercel")).toBe("allow");
    expect(d("vercel deploy --yes && rm -rf build")).toBe("ask"); // chained: a human decides
    expect(d("vercel --prod")).toBe("ask"); // tier 3 always asks
    expect(d("supabase db push")).toBe("ask"); // tier 2, but not in this allowlist
    expect(d("vercel deploy --yes", "aidw:fullstack")).toBe("deny");

    // the allowlist only holds while the change is open
    cli(root, "transition", ID, "paused", "--reason", "x");
    expect(d("vercel deploy --yes")).toBe("ask");
  });
});
