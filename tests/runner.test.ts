/**
 * S9 (D-30): `aidw run`, the headless auto-resume runner. A fake `claude` plays the sessions from a script.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { pathsFor } from "../src/project.js";
import { runLoop, waitMs } from "../src/runner.js";
import { tempProject, write } from "./fixtures.js";

const ID = "2026-11-10-app";

/**
 * Each session takes the next step from steps.json: { state?, paused?, progress?, tasks?, out?, exit?, archive? }.
 * It records its argv in calls.jsonl.
 */
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const root = process.cwd();
const dir = path.join(root, ".aidw/changes/${ID}");
const steps = JSON.parse(fs.readFileSync(path.join(root, "steps.json"), "utf8"));
const n = fs.existsSync(path.join(root, "calls.jsonl")) ? fs.readFileSync(path.join(root, "calls.jsonl"), "utf8").trim().split("\\n").length : 0;
fs.appendFileSync(path.join(root, "calls.jsonl"), JSON.stringify(process.argv.slice(2)) + "\\n");
const s = steps[n] || {};
if (s.progress) fs.appendFileSync(path.join(dir, "tasks.yaml"), "# progress " + n + "\\n");
if (s.tasks) fs.writeFileSync(path.join(dir, "tasks.yaml"), s.tasks);
if (s.state) {
  let y = fs.readFileSync(path.join(dir, "change.yaml"), "utf8").replace(/^state: .*$/m, "state: " + s.state);
  y = y.replace(/^  paused: .*$/m, "  paused: " + (s.paused ? JSON.stringify({ from: "executing", reason: s.paused, at: "2026-11-10T00:00:00Z" }) : "null"));
  fs.writeFileSync(path.join(dir, "change.yaml"), y);
}
if (s.archive) { fs.mkdirSync(path.join(root, ".aidw/archive"), { recursive: true }); fs.renameSync(dir, path.join(root, ".aidw/archive/2026-11-10-${ID}")); }
if (s.out) console.log(s.out);
if (s.json) console.log(JSON.stringify(s.json));
process.exit(s.exit || 0);
`;

function setup(state: string, steps: unknown[], paused?: string) {
  const root = tempProject();
  run(["init", "--root", root], {}, root, { out: () => {}, err: () => {} });
  run(["change", "new", ID, "--root", root], {}, root, { out: () => {}, err: () => {} });
  const file = join(root, ".aidw/changes", ID, "change.yaml");
  let y = readFileSync(file, "utf8").replace(/^state: .*$/m, `state: ${state}`);
  if (paused) y = y.replace(/^ {2}paused: .*$/m, `  paused: ${JSON.stringify({ from: "executing", reason: paused, at: "2026-11-10T00:00:00Z" })}`);
  writeFileSync(file, y);
  write(root, `.aidw/changes/${ID}/tasks.yaml`, "tasks: []\n");
  write(root, "steps.json", JSON.stringify(steps));
  const claude = write(root, "fake-claude", FAKE_CLAUDE);
  chmodSync(claude, 0o755);
  const sleeps: number[] = [];
  const lines: string[] = [];
  const go = (opts = {}) =>
    runLoop(pathsFor(root), ID, { claude, sleep: (ms) => sleeps.push(ms), log: (l) => lines.push(l), now: () => new Date("2026-11-10T10:00:00Z"), ...opts });
  const calls = () => (existsSync(join(root, "calls.jsonl")) ? readFileSync(join(root, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]) : []);
  return { root, go, sleeps, lines, calls };
}

describe("waitMs", () => {
  const now = new Date("2026-11-10T10:00:00Z");
  it("reads the reset time from the error, or backs off", () => {
    expect(waitMs("rate_limit: retry after 120 seconds", 0, now).ms).toBe(180_000);
    expect(waitMs("Usage limit reached. Try again in 5 minutes.", 0, now).ms).toBe(360_000);
    expect(waitMs(`limit, resets at ${Math.floor(now.getTime() / 1000) + 600}`, 0, now).ms).toBe(660_000);
    const local = new Date(now);
    local.setHours(local.getHours() + 2, 0, 0, 0);
    expect(waitMs(`5-hour limit reached ∙ resets ${local.getHours()}:00`, 0, now).ms).toBe(local.getTime() - now.getTime() + 60_000);
    expect([0, 1, 2, 3, 4, 9].map((a) => waitMs("rate_limit", a, now).ms / 60_000)).toEqual([5, 10, 20, 40, 60, 60]);
  });
});

describe("aidw run host-side preparation", () => {
  it("prepares before every session and before the machine check, so the check sees what it set up", () => {
    const t = setup("executing", [{ progress: true }, { progress: true }]);
    const order: string[] = [];
    t.go({ prepare: (st: string) => (order.push(`prepare:${st}`), null), preflight: () => (order.push("preflight"), null), maxRuns: 2 });
    expect(order.slice(0, 2)).toEqual(["prepare:executing", "preflight"]);
    expect(order.filter((o) => o.startsWith("prepare")).length).toBeGreaterThanOrEqual(2);
  });

  it("stops with needs_user, spending no session, when the preparation fails", () => {
    const t = setup("executing", [{ progress: true }]);
    const r = t.go({ prepare: () => "the test browser could not start" });
    expect(r).toMatchObject({ outcome: "needs_user", runs: 0, message: "the test browser could not start" });
    expect(t.calls()).toHaveLength(0);
  });

  it("calls onFinish with the outcome so what prepare started can be stopped", () => {
    const t = setup("executing", [{ progress: true }]);
    const seen: string[] = [];
    const r = t.go({ prepare: () => "stop here", onFinish: (o: string) => seen.push(o) });
    expect(seen).toEqual([r.outcome]);
  });
});

describe("aidw run preflight", () => {
  it("stops before spending a session when the machine check fails", () => {
    const t = setup("executing", [{ state: "executing", progress: true }]);
    const r = t.go({ preflight: () => "pnpm store: unreachable" });
    expect(r).toMatchObject({ outcome: "needs_user", runs: 0, message: "pnpm store: unreachable" });
    expect(t.calls()).toEqual([]);
  });
  it("does not stop a deploy that needs the user: it is recorded as failed and the run goes on to its pull request (T11, D12)", () => {
    const t = setup("deploying", [{ state: "delivered", progress: true, archive: true }]);
    const blocked: string[] = [];
    const deployBlocked = (problem: string) => {
      blocked.push(problem);
      const f = join(t.root, ".aidw/changes", ID, "change.yaml");
      writeFileSync(f, readFileSync(f, "utf8").replace(/^state: .*$/m, "state: delivered"));
      return null;
    };
    const r = t.go({ preflight: () => "vercel deployments: none yet", deployBlocked });
    expect(blocked).toEqual(["vercel deployments: none yet"]);
    expect(r.outcome).toBe("archived");
    // no session was spent on the deploy: the first one delivers
    expect(t.calls()).toHaveLength(1);
    expect(t.calls()[0]).toContain(`/aidw:deliver ${ID}`);
    expect(t.lines.join("\n")).toMatch(/recorded as a failed deploy/);
  });

  it("stops with needs_user when the failed deploy cannot be recorded", () => {
    const t = setup("deploying", [{ progress: true }]);
    const r = t.go({ preflight: () => "vercel: not logged in", deployBlocked: () => "the change is not deploying" });
    expect(r).toMatchObject({ outcome: "needs_user", runs: 0 });
    expect(r.message).toMatch(/vercel: not logged in/);
  });
  it("checks once at the start, and again only before deploy sessions", () => {
    const t = setup("executing", [{ state: "executing", progress: true }, { state: "deploying", progress: true }, { state: "archived", progress: true, archive: true }]);
    const seen: string[] = [];
    t.go({ preflight: (s: string) => (seen.push(s), null) });
    expect(seen).toEqual(["executing", "deploying"]);
  });
});

describe("runner.log keeps the whole final message, the cost and the turns (B3)", () => {
  it("logs every line of a long final message, each session's cost and turns, and a total", () => {
    const long = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
    const t = setup("executing", [
      { progress: true, json: { result: long, total_cost_usd: 0.5, num_turns: 12 } },
      { state: "archived", progress: true, archive: true, json: { result: "done", total_cost_usd: 0.25, num_turns: 3 } },
    ]);
    t.go();
    const log = readFileSync(join(t.root, ".aidw/run/runner.log"), "utf8");
    expect(log).toMatch(/session 1 ended: exit 0, \$0\.5000, 12 turns\n {2}\| line 1\n/);
    expect(log).toContain("  | line 30");
    expect(log).toMatch(/session 2 ended: exit 0, \$0\.2500, 3 turns\n {2}\| done/);
    expect(log).toMatch(/total: 2 sessions, \$0\.7500, 15 turns\n.*stop: archived/);
  });
  it("says the cost was not reported when the output is plain text, and keeps the whole text", () => {
    const t = setup("executing", [{ state: "archived", progress: true, archive: true, out: "first\nsecond" }]);
    t.go();
    const log = readFileSync(join(t.root, ".aidw/run/runner.log"), "utf8");
    expect(log).toMatch(/session 1 ended: exit 0\n {2}\| first\n {2}\| second/);
    expect(log).toMatch(/total: 1 session, cost not reported/);
  });
});

describe("aidw run", () => {
  it("waits out a pause, resumes headless with the permission mode and extra args, and stops on escalation", () => {
    const t = setup("paused", [{ state: "paused", paused: "rate_limit", progress: true }, { state: "escalated", progress: true }], "rate_limit: retry after 30 seconds");
    const r = t.go({ extraArgs: ["--plugin-dir", "/x/aidw"] });
    expect(r).toMatchObject({ outcome: "escalated", runs: 2, waits: 2, state: "escalated" });
    expect(t.sleeps).toEqual([90_000, 600_000]); // stated 30 s + margin, then backoff (second attempt: 10 min)
    expect(t.calls()).toEqual([
      ["-p", `/aidw:resume ${ID}`, "--permission-mode", "auto", "--output-format", "json", "--strict-mcp-config", "--plugin-dir", "/x/aidw"],
      ["-p", `/aidw:resume ${ID}`, "--permission-mode", "auto", "--output-format", "json", "--strict-mcp-config", "--plugin-dir", "/x/aidw"],
    ]);
    const log = readFileSync(join(t.root, ".aidw/run/runner.log"), "utf8");
    expect(log).toMatch(/paused \(rate_limit: retry after 30 seconds\): waiting 2 min, the error says retry after 30 seconds/);
    expect(log).toMatch(/stop: escalated/);
  });

  it("carries on past tasks that were not built and past the Agent-run cap, to delivery (ADR-0014)", () => {
    const notBuilt = "tasks:\n  - id: T01\n    status: done\n  - id: T02\n    status: not_built\n    not_built: { cause: environment, reason: 'triage: environment' }\n  - id: T03\n    status: not_built\n    not_built: { cause: cap, reason: 'the cap of 6 Agent runs set at the Approval Gate was reached (6 used)' }\n";
    const t = setup("executing", [{ tasks: notBuilt }, { state: "verifying", progress: true }, { state: "delivered", progress: true }, { archive: true }]);
    const r = t.go();
    expect(r).toMatchObject({ outcome: "archived", runs: 4 });
    expect(t.calls().map((c) => c[1])).toEqual([`/aidw:resume ${ID}`, `/aidw:resume ${ID}`, `/aidw:resume ${ID}`, `/aidw:deliver ${ID}`]);
  });

  it("waits when a session ends on a limit nobody recorded, then finishes when the change is archived", () => {
    const t = setup("executing", [{ out: "API Error: 429 rate_limit_error. Try again in 2 minutes", exit: 1 }, { state: "delivered", progress: true }, { archive: true }]);
    const r = t.go({ permissionMode: "acceptEdits" });
    expect(r).toMatchObject({ outcome: "archived", runs: 3, waits: 1 });
    expect(t.sleeps).toEqual([180_000]);
    expect(t.calls().map((c) => c[1])).toEqual([`/aidw:resume ${ID}`, `/aidw:resume ${ID}`, `/aidw:deliver ${ID}`]);
    expect(t.calls()[0]?.[3]).toBe("acceptEdits");
  });

  it("stops after two sessions without progress, at max runs, and before approval", () => {
    const idle = setup("executing", [{}, {}, {}]);
    expect(idle.go()).toMatchObject({ outcome: "no_progress", runs: 2 });
    const busy = setup("executing", [{ progress: true }, { progress: true }, { progress: true }]);
    expect(busy.go({ maxRuns: 2 })).toMatchObject({ outcome: "max_runs", runs: 2 });
    const early = setup("awaiting_approval", []);
    expect(early.go()).toMatchObject({ outcome: "needs_user", runs: 0 });
    expect(early.calls()).toEqual([]);
    const missing = setup("executing", []);
    expect(missing.go({ claude: join(missing.root, "no-such-claude") })).toMatchObject({ outcome: "claude_failed" });
  });

  it("refuses to run inside a Claude Code session and passes everything after -- to claude", () => {
    const t = setup("executing", [{ archive: true }]);
    let err = "";
    expect(run(["run", ID, "--root", t.root], { CLAUDECODE: "1" }, t.root, { out: () => {}, err: (s) => (err += s) })).not.toBe(0);
    expect(err).toMatch(/run it in your own terminal/);
    let out = "";
    let e2 = "";
    const code = run(["run", ID, "--root", t.root, "--claude", join(t.root, "fake-claude"), "--", "--plugin-dir", "/p", "--model", "opus"], {}, t.root, { out: (s) => (out += s), err: (s) => (e2 += s) });
    expect([code, e2, out.slice(-300)]).toEqual([0, "", expect.any(String)]);
    expect(out).toMatch(/DONE \(archived\) after 1 session\(s\), 0 wait\(s\)/);
    expect(t.calls()[0]).toEqual(["-p", `/aidw:resume ${ID}`, "--permission-mode", "auto", "--output-format", "json", "--strict-mcp-config", "--plugin-dir", "/p", "--model", "opus"]);
  });
});

void mkdirSync;
void renameSync;

import { runnerPid, stopRunner } from "../src/runner.js";

describe("aidw run --detach helpers", () => {
  it("ignores a stale pid file, sees a live one, and refuses a foreground loop inside a session but not --status", () => {
    const t = setup("executing", []);
    const p = pathsFor(t.root);
    write(t.root, ".aidw/run/runner.pid", "999999");
    expect(runnerPid(p)).toBeNull();
    write(t.root, ".aidw/run/runner.pid", String(process.pid));
    expect(runnerPid(p)).toBe(process.pid);
    rmSync(join(t.root, ".aidw/run/runner.pid"));
    expect(stopRunner(p)).toBeNull();
    const out: string[] = [];
    const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s) };
    expect(run(["run", "--status", "--root", t.root], { CLAUDECODE: "1" }, t.root, io)).toBe(0);
    expect(out.join("")).toMatch(/no background runner/);
    expect(run(["run", ID, "--root", t.root], { CLAUDECODE: "1" }, t.root, io)).toBe(1);
    expect(out.join("")).toMatch(/--detach/);
  });
});
