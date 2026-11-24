/**
 * T11 (D12, ADR-0012, ADR-0014): the run always ends in a pull request. Ready when everything passed, a draft otherwise;
 * the body opens with three fixed sections. The pull request opens before the archive, so the push grant still sees
 * the Change; `/aidw:resume` finishes a draft and updates the same pull request. A local bare repository stands in for
 * the remote and a fake `gh` records what it was asked; nothing reaches a real remote.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { HANDOFF_SECTIONS } from "../src/deliver.js";
import { decide, type HookInput } from "../src/gate.js";
import { pathsFor } from "../src/project.js";
import { runLoop } from "../src/runner.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, tempProject, write, planReviewed } from "./fixtures.js";

const ID = "app";
const GRANTS = "grants:\n  push:\n    remote: origin\n    base: main\n";
const PR_URL = "https://github.com/acme/app/pull/7";

let root: string;
let bare: string;
let ghLog: string;
const saved: Record<string, string | undefined> = {};

const FAKE_GH = `#!/usr/bin/env node
const fs = require("fs");
const a = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(a) + "\\n");
if (a[0] === "pr" && a[1] === "create") console.log("${PR_URL}");
`;

beforeAll(() => {
  const bin = tempProject();
  chmodSync(write(bin, "gh", FAKE_GH), 0o755);
  for (const k of ["PATH", "FAKE_GH_LOG", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) saved[k] = process.env[k];
  process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
  Object.assign(process.env, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.invalid" });
});

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function cli(argv: string[], env: NodeJS.ProcessEnv = {}) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], env, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}

const bash = (command: string, agent_type?: string): string =>
  decide({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: root, ...(agent_type ? { agent_type } : {}) } as HookInput, {})?.decision ?? "none";
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
const ghCalls = (): string[][] => (existsSync(ghLog) ? readFileSync(ghLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]) : []);

const changeDir = () => join(root, ".aidw/changes", ID);
const changeData = () => YAML.parse(readFileSync(join(changeDir(), "change.yaml"), "utf8")) as Record<string, any>;
function setChange(patch: (d: Record<string, any>) => void) {
  const d = changeData();
  patch(d);
  writeFileSync(join(changeDir(), "change.yaml"), YAML.stringify(d));
}
function setTasks(patch: (tasks: Record<string, any>[]) => void) {
  const f = join(changeDir(), "tasks.yaml");
  const d = YAML.parse(readFileSync(f, "utf8")) as { tasks: Record<string, any>[] };
  patch(d.tasks);
  writeFileSync(f, YAML.stringify(d));
}
const json = (rel: string, data: unknown) => write(root, `.aidw/changes/${ID}/${rel}`, `${JSON.stringify(data, null, 2)}\n`);

/** An approved Change on its Change Branch, with a bare repository as origin. */
function approved(quality = QUALITY_YAML + GRANTS) {
  root = tempProject();
  bare = join(tempProject(), "remote.git");
  ghLog = join(root, "..", `gh-${Math.random().toString(36).slice(2)}.log`);
  process.env.FAKE_GH_LOG = ghLog;
  git(root, "init", "-q", "-b", "main");
  write(root, "README.md", "# app\n");
  git(root, "add", "README.md");
  git(root, "commit", "-q", "-m", "chore: start");
  execFileSync("git", ["init", "-q", "--bare", bare]);
  git(root, "remote", "add", "origin", bare);
  cli(["init"]);
  cli(["change", "new", ID]);
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  write(root, `.aidw/changes/${ID}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `.aidw/changes/${ID}/tasks.yaml`, TASKS_YAML);
  write(root, `.aidw/changes/${ID}/quality.yaml`, quality);
  write(root, `.aidw/changes/${ID}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  planReviewed(root, ID);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(["transition", ID, s]).code).toBe(0);
  expect(cli(["approve", ID]).code).toBe(0);
  expect(cli(["transition", ID, "executing"]).code).toBe(0);
  expect(git(root, "branch", "--show-current")).toBe("aidw/app");
}

const SCENARIO = "booking/reschedule-appointment/reschedule-appointment-works";

/** The evidence of a finished run: every layer passed, converge passed, the preview deployed; the Change is delivered. */
function finished(opts: { deploy?: { ok: boolean; error?: string } } = {}) {
  setTasks((ts) => ts.forEach((t) => ["pending", "failed"].includes(t.status) && (t.status = "done")));
  const head = git(root, "rev-parse", "HEAD");
  const at = new Date().toISOString();
  json("evidence/quality/summary.json", { layers: Object.fromEntries(["code", "unit", "e2e"].map((n) => [n, { status: "pass", at, head, runs: [] }])) });
  json("evidence/converge.json", { runs: [{ at, head, mode: "presence", ok: true, scenarios: { [SCENARIO]: { status: "pass", where: ["t.test.ts:1"] } }, added: [], not_built: [] }] });
  const d = opts.deploy ?? { ok: true };
  json("evidence/deploy.json", { runs: [{ at, target: "preview", ok: d.ok, skipped: false, url: d.ok ? "https://app-preview.vercel.app" : null, head, runs: [], smoke: [], ...(d.error ? { error: d.error } : {}) }] });
  setChange((c) => (c.state = "deploying"));
  expect(cli(["transition", ID, "delivered"]).code).toBe(0);
}

/** T01 was not built for an environment cause (its discarded work saved), and T02, which depends on it, with it. */
function t01NotBuilt() {
  write(root, ".aidw/run/evidence/notbuilt-T01.patch", "diff --git a/app/api/bookings/route.ts b/app/api/bookings/route.ts\n");
  setTasks((ts) => {
    ts[0]!.status = "not_built";
    ts[0]!.started_at = "2026-11-24T00:00:00Z";
    ts[0]!.attempts = 2;
    ts[0]!.not_built = { cause: "environment", reason: "STRIPE_TEST_KEY is not set in .env", at: "2026-11-24T00:00:00Z", discarded: ["app/api/bookings/route.ts"], saved: [".aidw/run/evidence/notbuilt-T01.patch"] };
    ts[1]!.status = "not_built";
    ts[1]!.not_built = { cause: "dependency", reason: "depends on T01, which is not built", at: "2026-11-24T00:00:00Z" };
  });
  const at = new Date().toISOString();
  json("evidence/converge.json", { runs: [{ at, head: null, mode: "presence", ok: true, scenarios: { [SCENARIO]: { status: "missing", where: [] } }, added: [], not_built: [{ scenario: SCENARIO, reason: "its task T01 was not built" }] }] });
}

const section = (body: string, name: string): string => {
  const m = new RegExp(`## ${name}\\n\\n([\\s\\S]*?)(?=\\n## |$)`).exec(body);
  return m ? (m[1] as string).trim() : "(missing)";
};

describe("the pull request at the end of the run", () => {
  it("is ready when every layer passed and nothing is not built; the three sections say Nothing.", () => {
    approved();
    finished();
    const r = cli(["pr", ID, "--create", "--json"]);
    expect(r.code, r.err).toBe(0);
    const out = JSON.parse(r.out) as { url: string; draft: boolean };
    expect(out).toMatchObject({ url: PR_URL, draft: false });
    const create = ghCalls().find((c) => c[1] === "create")!;
    expect(create).not.toContain("--draft");
    const body = readFileSync(join(root, ".aidw/run/pr-app.md"), "utf8");
    const heads = [...body.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(heads.slice(0, 4)).toEqual(["Differs from the approved package", "Not built and why", "Needed from the user to finish", "Summary"]);
    for (const s of ["Differs from the approved package", "Not built and why", "Needed from the user to finish"]) expect(section(body, s)).toBe("Nothing.");
    // the Change Branch reached the remote, with the delivery package committed before the push
    expect(git(bare, "rev-parse", "refs/heads/aidw/app")).toBe(git(root, "rev-parse", "HEAD"));
    expect(changeData().run.pr).toMatchObject({ url: PR_URL, draft: false });
  });

  it("is a draft with all three sections filled when a task is not built", () => {
    approved();
    finished();
    t01NotBuilt();
    write(
      root,
      `.aidw/changes/${ID}/deviations.yaml`,
      YAML.stringify({
        deviations: [
          {
            id: "D01",
            status: "closed",
            roles: ["business-analyst"],
            files: [`.aidw/changes/${ID}/specs/booking/spec.md`],
            authors: {},
            reason: "the clinic API cannot move an appointment across practitioners",
            opened_at: "2026-11-24T00:00:00Z",
            previous: "sha256:x",
            before: {},
            closed_at: "2026-11-24T01:00:00Z",
            summary: "rescheduling keeps the practitioner",
            scenarios: { removed: [{ scenario: "booking/reschedule-appointment/other-practitioner", reason: "the API refuses it" }], added: [], changed: [SCENARIO] },
            requirements: { added: [], removed: [], changed: ["booking/reschedule-appointment"] },
            contracts: [{ file: `.aidw/changes/${ID}/openapi.yaml`, kind: "openapi", class: "additive", changes: ["added GET /slots"] }],
            tasks: { added: [], removed: [], removed_done: [], changed: ["T01"] },
            rerun: ["T01"],
          },
        ],
      }),
    );
    const r = cli(["pr", ID, "--create", "--json"]);
    expect(r.code, r.err).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ draft: true });
    expect(ghCalls().find((c) => c[1] === "create")).toContain("--draft");
    const body = readFileSync(join(root, ".aidw/run/pr-app.md"), "utf8");

    const differs = section(body, "Differs from the approved package");
    expect(differs).toMatch(/D01/);
    expect(differs).toMatch(/business-analyst/);
    expect(differs).toMatch(/cannot move an appointment across practitioners/);
    expect(differs).toMatch(/rescheduling keeps the practitioner/);
    expect(differs).toMatch(/other-practitioner.*the API refuses it/);
    expect(differs).toMatch(/additive/);

    const notBuilt = section(body, "Not built and why");
    expect(notBuilt).toMatch(/T01.*environment.*STRIPE_TEST_KEY/);
    expect(notBuilt).toMatch(/T02/);
    // the discarded work is committed with the Change, not left in the machine-local .aidw/run/
    expect(notBuilt).toContain(`.aidw/changes/${ID}/delivery/not-built/T01.patch`);
    expect(existsSync(join(changeDir(), "delivery/not-built/T01.patch"))).toBe(true);
    expect(git(root, "ls-files", `.aidw/changes/${ID}/delivery/not-built/T01.patch`)).not.toBe("");
    expect(notBuilt).toContain(SCENARIO);

    const needed = section(body, "Needed from the user to finish");
    expect(needed).toMatch(/STRIPE_TEST_KEY/);
    expect(needed).toMatch(/\/aidw:resume app/);
  });

  it("lists a layer that is not built and the Agent-run cap", () => {
    approved();
    finished();
    const head = git(root, "rev-parse", "HEAD");
    json("evidence/quality/summary.json", {
      layers: {
        code: { status: "pass", at: "x", head, runs: [] },
        unit: { status: "pass", at: "x", head, runs: [] },
        e2e: { status: "not_built", at: "x", head, runs: [], not_built_reason: "still failing after 2 fix round(s): Docker is not running" },
      },
    });
    setChange((c) => (c.approval.agent_run_cap = 2));
    json("evidence/agent-runs.json", { runs: [{ key: "implementer:a", kind: "implementer", at: "x" }, { key: "reviewer:a", kind: "reviewer", at: "x" }] });
    const body = JSON.parse(cli(["pr", ID, "--json"]).out).body as string;
    expect(section(body, "Not built and why")).toMatch(/e2e.*Docker is not running/);
    expect(section(body, "Not built and why")).toMatch(/2 of 2/);
    const needed = section(body, "Needed from the user to finish");
    expect(needed).toMatch(/aidw cap app --raise/);
    expect(needed).toMatch(/e2e/);
  });

  it("still opens, as a draft, when the deploy failed; the deploy is needed from the user", () => {
    approved();
    finished({ deploy: { ok: false, error: "deploy command exited 1: the Vercel CLI is not logged in. The user runs `vercel login` in their own terminal" } });
    expect(changeData().state).toBe("delivered");
    const r = cli(["pr", ID, "--create", "--json"]);
    expect(r.code, r.err).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ draft: true });
    const body = readFileSync(join(root, ".aidw/run/pr-app.md"), "utf8");
    expect(section(body, "Needed from the user to finish")).toMatch(/[Dd]eploy.*vercel login/);
  });
});

describe("the push grant at delivery", () => {
  it("lets the pull request through without asking while the Change is delivered; the archive commit follows it", () => {
    approved();
    finished();
    expect(bash("aidw pr app --create")).toBe("allow");
    cli(["deliver", "--change", ID]);
    const handoff = HANDOFF_SECTIONS.map((s) => `## ${s}\n\nNone\n`).join("\n");
    write(root, `.aidw/changes/${ID}/delivery/handoff.md`, `# Handoff\n\n${handoff}`);
    write(root, `.aidw/changes/${ID}/delivery/screenshots/01-book.png`, "png");
    const check = cli(["deliver", "--check", "--change", ID]);
    expect(check.code, check.out + check.err).toBe(0);
    expect(cli(["pr", ID, "--create"]).code).toBe(0);
    const a = cli(["archive", ID]);
    expect(a.code, a.err).toBe(0);
    expect(a.out).toMatch(/pushed aidw\/app to origin/);
    expect(git(bare, "rev-parse", "refs/heads/aidw/app")).toBe(git(root, "rev-parse", "HEAD"));
    // archived, the Change is no longer covered by its grant: a push of it asks
    expect(bash("aidw pr app --create")).toBe("ask");
  });

  it("puts the pull request before the archive in the deliver skill", () => {
    const skill = readFileSync(join(__dirname, "../plugins/aidw/skills/deliver/SKILL.md"), "utf8");
    const pr = skill.indexOf("aidw pr <id> --create");
    const archive = skill.indexOf("aidw archive <id>");
    expect(pr).toBeGreaterThan(0);
    expect(archive).toBeGreaterThan(pr);
  });

  it("without the grant, in runner mode, writes the body and gives the user a NEXT instead of pushing", () => {
    approved(QUALITY_YAML);
    finished();
    t01NotBuilt();
    expect(bash("aidw pr app --create")).toBe("ask");
    const r = cli(["pr", ID], { AIDW_RUNNER: "1" });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/push: not granted/);
    expect(r.out).toMatch(/NEXT: .*aidw pr app --create --draft/);
    expect(existsSync(join(root, ".aidw/run/pr-app.md"))).toBe(true);
    expect(changeData().run.pr).toMatchObject({ url: null, draft: true });
    expect(ghCalls()).toEqual([]);
  });
});

describe("the runner ends at the pull request", () => {
  const FAKE_CLAUDE = (pr: unknown) => `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
fs.appendFileSync(path.join(process.cwd(), "calls.log"), process.argv.slice(2).join(" ") + "\\n");
const f = path.join(process.cwd(), ".aidw/changes/${ID}/change.yaml");
const y = fs.readFileSync(f, "utf8");
if (!/^  pr:/m.test(y)) fs.writeFileSync(f, y.replace(/^run:\\n/m, "run:\\n  pr: ${JSON.stringify(pr).replace(/"/g, '\\"')}\\n"));
`;

  function runnerProject(pr: unknown) {
    root = tempProject();
    cli(["init"]);
    cli(["change", "new", ID]);
    write(root, `.aidw/changes/${ID}/tasks.yaml`, "tasks: []\n");
    setChange((c) => {
      c.state = "delivered";
      c.run = { paused: null };
    });
    const claude = write(root, "fake-claude", FAKE_CLAUDE(pr));
    chmodSync(claude, 0o755);
    return claude;
  }

  it("stops with a draft outcome and a NEXT when the body was written without the push grant (no hang)", () => {
    const claude = runnerProject({ url: null, draft: true, at: "x" });
    const r = runLoop(pathsFor(root), ID, { claude, sleep: () => {}, maxRuns: 5 });
    expect(r.outcome).toBe("draft");
    expect(r.runs).toBe(1);
    expect(r.message).toMatch(/pr-app\.md/);
    expect(r.message).toMatch(/aidw pr app --create --draft/);
    expect(r.message).toMatch(/\/aidw:resume app/);
  });

  it("stops with the draft's URL when it opened", () => {
    const claude = runnerProject({ url: PR_URL, draft: true, at: "x" });
    const r = runLoop(pathsFor(root), ID, { claude, sleep: () => {}, maxRuns: 5 });
    expect(r).toMatchObject({ outcome: "draft", runs: 1 });
    expect(r.message).toContain(PR_URL);
    // the session of a delivered Change without a pull request yet is the delivery
    expect(readFileSync(join(root, "calls.log"), "utf8")).toMatch(/\/aidw:deliver app/);
  });

  it("resumes a draft in its first session instead of delivering again", () => {
    const claude = runnerProject({ url: PR_URL, draft: true, at: "x" });
    setChange((c) => (c.run = { paused: null, pr: { url: PR_URL, draft: true, at: "x" } }));
    const r = runLoop(pathsFor(root), ID, { claude, sleep: () => {}, maxRuns: 5 });
    expect(readFileSync(join(root, "calls.log"), "utf8")).toMatch(/\/aidw:resume app/);
    expect(r.outcome).toBe("draft");
  });
});

describe("resume finishes a draft", () => {
  it("runs the not-built tasks again, then updates the same pull request and marks it ready", () => {
    approved();
    finished();
    t01NotBuilt();
    expect(cli(["pr", ID, "--create"]).code).toBe(0);
    expect(changeData().run.pr).toMatchObject({ url: PR_URL, draft: true });

    // the user provided the key; /aidw:resume takes the Change back to executing
    const t = cli(["transition", ID, "executing"]);
    expect(t.code, t.err).toBe(0);
    expect(t.out).toMatch(/T01/);
    const tasks = (YAML.parse(readFileSync(join(changeDir(), "tasks.yaml"), "utf8")) as { tasks: Record<string, any>[] }).tasks;
    expect(tasks.map((x) => [x.id, x.status, x.not_built ?? null])).toEqual([
      ["T01", "failed", null],
      ["T02", "pending", null],
    ]);

    // the run builds them; the Change is delivered again
    write(root, "app/api/bookings/route.ts", "export {};\n");
    git(root, "add", "app");
    git(root, "commit", "-q", "-m", "feat(booking): booking api");
    finished();
    const r = cli(["pr", ID, "--create", "--json"]);
    expect(r.code, r.err).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ url: PR_URL, draft: false, updated: true });
    const calls = ghCalls();
    expect(calls.filter((c) => c[1] === "create")).toHaveLength(1);
    expect(calls.find((c) => c[1] === "edit")).toEqual(expect.arrayContaining(["pr", "edit", PR_URL, "--body-file"]));
    expect(calls.find((c) => c[1] === "ready")).toEqual(["pr", "ready", PR_URL]);
    expect(git(bare, "rev-parse", "refs/heads/aidw/app")).toBe(git(root, "rev-parse", "HEAD"));
    expect(changeData().run.pr).toMatchObject({ url: PR_URL, draft: false });
  });

  it("refuses to reopen a delivered Change that has nothing to finish", () => {
    approved();
    finished();
    const t = cli(["transition", ID, "executing"]);
    expect(t.code).toBe(1);
    expect(t.err).toMatch(/nothing to finish/);
  });

  it("task retry accepts a not-built task and brings its dependants back", () => {
    approved();
    setTasks((ts) => {
      ts[0]!.status = "not_built";
      ts[0]!.attempts = 3;
      ts[0]!.started_at = "x";
      ts[0]!.not_built = { cause: "fix-rounds", reason: "still failing after 3 rounds", at: "x" };
      ts[1]!.status = "not_built";
      ts[1]!.not_built = { cause: "dependency", reason: "depends on T01, which is not built", at: "x" };
    });
    const r = cli(["task", "retry", "T01", "--change", ID]);
    expect(r.code, r.err).toBe(0);
    const tasks = (YAML.parse(readFileSync(join(changeDir(), "tasks.yaml"), "utf8")) as { tasks: Record<string, any>[] }).tasks;
    expect(tasks.map((x) => [x.id, x.status, x.attempts ?? 0])).toEqual([
      ["T01", "failed", 0],
      ["T02", "pending", 0],
    ]);
  });

  it("task retry of a task not built at the cap asks for the cap to be raised first", () => {
    approved();
    setChange((c) => (c.approval.agent_run_cap = 1));
    json("evidence/agent-runs.json", { runs: [{ key: "implementer:a", kind: "implementer", at: "x" }] });
    setTasks((ts) => {
      ts[0]!.status = "not_built";
      ts[0]!.not_built = { cause: "cap", reason: "the cap", at: "x" };
    });
    const r = cli(["task", "retry", "T01", "--change", ID]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/aidw cap app --raise/);
  });
});

describe("aidw cap", () => {
  beforeEach(() => approved());

  it("raises the cap in the approval record, with a history entry; the approval stays valid", () => {
    const before = changeData().approval.agent_run_cap as number;
    const r = cli(["cap", ID, "--raise", "10"]);
    expect(r.code, r.err).toBe(0);
    const a = changeData().approval;
    expect(a.agent_run_cap).toBe(before + 10);
    expect(a.history.at(-1)).toMatchObject({ cap: { from: before, to: before + 10 }, by: "user" });
    expect(cli(["approval", "check", ID]).code).toBe(0);
  });

  it("is the user's: the gate asks the lead and denies an Agent", () => {
    expect(bash("aidw cap app --raise 10")).toBe("ask");
    expect(bash("aidw cap app --raise 10", "aidw:backend")).toBe("deny");
  });

  it("refuses a raise that is not a positive whole number", () => {
    for (const n of ["0", "-3", "x", "1.5"]) expect([n, cli(["cap", ID, "--raise", n]).code]).toEqual([n, 1]);
  });
});
