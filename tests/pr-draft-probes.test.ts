/**
 * T11 probes (D12, ADR-0012, ADR-0014): the edges of the ready rule, the three fixed sections, the pull request that
 * already exists, what `aidw pr --create` commits, the archive push, the cap and resume, and the runner's exit code.
 * A local bare repository stands in for the remote and a fake `gh` records what it was asked; nothing reaches a real
 * remote.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { HANDOFF_SECTIONS } from "../src/deliver.js";
import { decide, type HookInput } from "../src/gate.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, tempProject, write, planReviewed } from "./fixtures.js";

const ID = "app";
const GRANTS = "grants:\n  push:\n    remote: origin\n    base: main\n";
const PR_URL = "https://github.com/acme/app/pull/7";
const SCENARIO = "booking/reschedule-appointment/reschedule-appointment-works";

let root: string;
let bare: string;
let ghLog: string;
const saved: Record<string, string | undefined> = {};

/**
 * Behaves like the real gh for what aidw asks: `pr create` refuses a second pull request for the same branch (and
 * names the open one), `pr list` / `pr view` find it.
 */
const FAKE_GH = `#!/usr/bin/env node
const fs = require("fs");
const a = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(a) + "\\n");
const open = process.env.FAKE_GH_LOG + ".open";
if (a[0] === "pr" && a[1] === "create") {
  if (fs.existsSync(open)) {
    process.stderr.write('a pull request for branch "aidw/app" into branch "main" already exists:\\n${PR_URL}\\n');
    process.exit(1);
  }
  fs.writeFileSync(open, "1");
  console.log("${PR_URL}");
}
if (a[0] === "pr" && (a[1] === "list" || a[1] === "view")) {
  if (!fs.existsSync(open)) { if (a[1] === "view") { process.stderr.write("no pull requests found"); process.exit(1); } console.log("[]"); process.exit(0); }
  const pr = { url: "${PR_URL}", number: 7, isDraft: true, state: "OPEN", headRefName: "aidw/app" };
  console.log(JSON.stringify(a[1] === "list" ? [pr] : pr));
}
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
}

function passing(layers: Record<string, string> = {}) {
  const head = git(root, "rev-parse", "HEAD");
  const at = new Date().toISOString();
  json("evidence/quality/summary.json", { layers: Object.fromEntries(["code", "unit", "e2e"].map((n) => [n, { status: layers[n] ?? "pass", at, head, runs: [] }])) });
}

function finished(opts: { deploy?: Record<string, unknown> } = {}) {
  setTasks((ts) => ts.forEach((t) => ["pending", "failed"].includes(t.status) && (t.status = "done")));
  const head = git(root, "rev-parse", "HEAD");
  const at = new Date().toISOString();
  passing();
  json("evidence/converge.json", { runs: [{ at, head, mode: "presence", ok: true, scenarios: { [SCENARIO]: { status: "pass", where: ["t.test.ts:1"] } }, added: [], not_built: [] }] });
  json("evidence/deploy.json", { runs: [{ at, target: "preview", ok: true, skipped: false, url: "https://app-preview.vercel.app", head, runs: [], smoke: [], ...(opts.deploy ?? {}) }] });
  setChange((c) => (c.state = "deploying"));
  expect(cli(["transition", ID, "delivered"]).code).toBe(0);
}

const readiness = () => {
  const r = JSON.parse(cli(["pr", ID, "--json"]).out) as { ready: boolean; why: string[]; body: string };
  return r;
};

const section = (body: string, name: string): string => {
  const m = new RegExp(`## ${name}\\n\\n([\\s\\S]*?)(?=\\n## |$)`).exec(body);
  return m ? (m[1] as string).trim() : "(missing)";
};
const count = (text: string, re: RegExp) => [...text.matchAll(new RegExp(re.source, "g"))].length;

/** The delivery package completed, as /aidw:deliver leaves it. */
function packaged() {
  cli(["deliver", "--change", ID]);
  const handoff = HANDOFF_SECTIONS.map((s) => `## ${s}\n\nNone\n`).join("\n");
  write(root, `.aidw/changes/${ID}/delivery/handoff.md`, `# Handoff\n\n${handoff}`);
  write(root, `.aidw/changes/${ID}/delivery/screenshots/01-book.png`, "png");
  const check = cli(["deliver", "--check", "--change", ID]);
  expect(check.code, check.out + check.err).toBe(0);
}

describe("the ready rule at its edges", () => {
  it("a task not built makes a draft by itself (converge and every layer passed)", () => {
    approved();
    finished();
    setTasks((ts) => {
      ts[1]!.status = "not_built";
      ts[1]!.not_built = { cause: "environment", reason: "no SMTP server", at: "x" };
    });
    const r = readiness();
    expect(r.ready).toBe(false);
    expect(r.why.join("; ")).toMatch(/not built: T02/);
  });

  it("a layer that failed, waits for its review, or never ran keeps it a draft", () => {
    for (const [layers, status] of [
      [{ e2e: "fail" }, "fail"],
      [{ e2e: "review" }, "review"],
    ] as const) {
      approved();
      finished();
      passing(layers);
      const r = readiness();
      expect(r.ready, status).toBe(false);
      expect(r.why.join("; ")).toMatch(new RegExp(`e2e \\(${status}\\)`));
    }
    approved();
    finished();
    json("evidence/quality/summary.json", { layers: { code: { status: "pass", at: "x", head: null, runs: [] } } });
    const r = readiness();
    expect(r.ready).toBe(false);
    expect(r.why.join("; ")).toMatch(/unit \(not run\).*e2e \(not run\)/);
  });

  it("a scenario converge left not built makes a draft", () => {
    approved();
    finished();
    json("evidence/converge.json", { runs: [{ at: "x", head: null, mode: "presence", ok: true, scenarios: {}, added: [], not_built: [{ scenario: SCENARIO, reason: "its layer is not built" }] }] });
    const r = readiness();
    expect(r.ready).toBe(false);
    expect(r.why.join("; ")).toMatch(/scenarios not built: 1/);
  });

  it("a task still escalated or pending is not finished: a draft", () => {
    approved();
    finished();
    setTasks((ts) => (ts[1]!.status = "escalated"));
    const r = readiness();
    expect(r.ready).toBe(false);
    expect(r.why.join("; ")).toMatch(/not finished: T02 \(escalated\)/);
  });

  it("a profile without a deploy (the deploy recorded as skipped) can still be ready", () => {
    approved();
    finished({ deploy: { target: "none", skipped: true, url: null } });
    const r = readiness();
    expect(r.why).toEqual([]);
    expect(r.ready).toBe(true);
  });
});

describe("the three fixed sections", () => {
  function deviation(id: string, status: string, reason: string) {
    return {
      id,
      status,
      roles: ["business-analyst"],
      files: [`.aidw/changes/${ID}/specs/booking/spec.md`],
      authors: {},
      reason,
      opened_at: "2026-11-24T00:00:00Z",
      previous: "sha256:x",
      before: {},
      ...(status === "closed" ? { closed_at: "2026-11-24T01:00:00Z", summary: `summary of ${id}` } : {}),
    };
  }

  it("lists every closed Deviation in order and leaves out an abandoned one", () => {
    approved();
    finished();
    write(
      root,
      `.aidw/changes/${ID}/deviations.yaml`,
      YAML.stringify({ deviations: [deviation("D01", "closed", "first reason"), deviation("D02", "abandoned", "abandoned reason"), deviation("D03", "closed", "third reason")] }),
    );
    const differs = section(readiness().body, "Differs from the approved package");
    expect(differs).toMatch(/\*\*D01\*\*[\s\S]*first reason[\s\S]*\*\*D03\*\*[\s\S]*third reason/);
    expect(differs).not.toMatch(/D02|abandoned reason/);
  });

  it("names the dependants once, under the task they depend on, chain included", () => {
    approved();
    finished();
    setTasks((ts) => {
      ts.push({ id: "T03", title: "Booking emails", role: "backend-engineer", type: "feat", depends_on: ["T02"], touches: ["lib/mail/**"], verify: ["pnpm vitest run lib/mail"], status: "not_built", not_built: { cause: "dependency", reason: "depends on T02, which is not built", at: "x" } });
      ts[0]!.status = "not_built";
      ts[0]!.not_built = { cause: "environment", reason: "STRIPE_TEST_KEY is not set in .env", at: "x" };
      ts[1]!.status = "not_built";
      ts[1]!.not_built = { cause: "dependency", reason: "depends on T01, which is not built", at: "x" };
    });
    const body = readiness().body;
    const notBuilt = section(body, "Not built and why");
    expect(notBuilt).toMatch(/\*\*T01\*\*.*Not built with it \(they depend on it\): T02, T03\./);
    // each dependant once: no line of its own besides the one of T01
    expect(count(notBuilt, /T02/)).toBe(1);
    expect(count(notBuilt, /T03/)).toBe(1);
    expect(notBuilt.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(1);
    expect(section(body, "Needed from the user to finish")).toMatch(/builds T01 \(and T02, T03\) again/);
  });

  it("lists a dependant whose root is not in the plan any more on its own line", () => {
    approved();
    finished();
    setTasks((ts) => {
      ts[1]!.status = "not_built";
      ts[1]!.not_built = { cause: "dependency", reason: "depends on T01, which is not built", at: "x" };
    });
    const notBuilt = section(readiness().body, "Not built and why");
    expect(notBuilt).toMatch(/^- \*\*T02\*\* Booking page: depends on T01, which is not built\.$/m);
  });
});

describe("a pull request that already exists", () => {
  it("goes back to draft (gh pr ready --undo) when a layer fails after it opened ready", () => {
    approved();
    finished();
    expect(cli(["pr", ID, "--create"]).code).toBe(0);
    expect(changeData().run.pr).toMatchObject({ url: PR_URL, draft: false });
    passing({ e2e: "fail" });
    const r = cli(["pr", ID, "--create", "--json"]);
    expect(r.code, r.err).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ url: PR_URL, draft: true, updated: true });
    const calls = ghCalls();
    expect(calls.filter((c) => c[1] === "create")).toHaveLength(1);
    expect(calls.find((c) => c[1] === "edit")).toEqual(expect.arrayContaining(["pr", "edit", PR_URL, "--body-file"]));
    expect(calls.find((c) => c[1] === "ready")).toEqual(["pr", "ready", PR_URL, "--undo"]);
    expect(changeData().run.pr).toMatchObject({ url: PR_URL, draft: true });
    expect(section(readFileSync(join(root, ".aidw/run/pr-app.md"), "utf8"), "Not built and why")).toBe("Nothing.");
  });

  it("stays as it is (no ready call) when it was a draft and still is one", () => {
    approved();
    finished();
    passing({ e2e: "fail" });
    expect(cli(["pr", ID, "--create"]).code).toBe(0);
    expect(cli(["pr", ID, "--create"]).code).toBe(0);
    expect(ghCalls().filter((c) => c[1] === "ready")).toEqual([]);
    expect(ghCalls().filter((c) => c[1] === "edit")).toHaveLength(1);
  });
});

describe("what `aidw pr --create` commits", () => {
  it("only .aidw/ and the delivery files: never .env, secrets, other work or the machine-local .aidw/run/", () => {
    approved();
    finished();
    const before = git(root, "rev-parse", "HEAD");
    write(root, ".env", "STRIPE_SECRET=sk_live_x\n");
    write(root, ".env.example", "STRIPE_SECRET=\n");
    write(root, "README.md", "# app\n\nHow to run it.\n");
    write(root, "secrets/key.pem", "-----BEGIN PRIVATE KEY-----\n");
    write(root, "src/wip.ts", "export const wip = 1;\n");
    expect(cli(["pr", ID, "--create"]).code).toBe(0);
    const files = git(root, "diff", "--name-only", `${before}..HEAD`).split("\n").filter(Boolean);
    expect(files).toEqual(expect.arrayContaining(["README.md", ".env.example"]));
    for (const f of files) expect(f === "README.md" || f === ".env.example" || f === ".gitignore" || f.startsWith(".aidw/"), f).toBe(true);
    expect(files.filter((f) => f.startsWith(".aidw/run/"))).toEqual([]);
    expect(git(root, "ls-files", ".env", "secrets", "src/wip.ts")).toBe("");
    // the remote got the same commit, nothing else
    expect(git(bare, "rev-parse", "refs/heads/aidw/app")).toBe(git(root, "rev-parse", "HEAD"));
    expect(git(bare, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/aidw/app");
  });
});

describe("the archive pushes its own commit only under the grant", () => {
  it("does not push without the push grant, even with a pull request recorded", () => {
    approved(QUALITY_YAML);
    finished();
    packaged();
    // the user opened it by hand (`aidw pr --create`, asked), and the record says so
    git(root, "push", "-q", "-u", "origin", "aidw/app");
    setChange((c) => (c.run.pr = { url: PR_URL, draft: false, at: "x" }));
    git(root, "add", ".aidw");
    git(root, "commit", "-q", "-m", "chore: record");
    git(root, "push", "-q", "origin", "aidw/app");
    const remoteBefore = git(bare, "rev-parse", "refs/heads/aidw/app");
    const a = cli(["archive", ID]);
    expect(a.code, a.err).toBe(0);
    expect(a.out).not.toMatch(/pushed/);
    expect(git(bare, "rev-parse", "refs/heads/aidw/app")).toBe(remoteBefore);
    expect(git(root, "rev-parse", "HEAD")).not.toBe(remoteBefore);
  });

  it("does not push when the grant no longer holds: the remote was repointed after the pull request opened", () => {
    approved();
    finished();
    packaged();
    expect(cli(["pr", ID, "--create"]).code).toBe(0);
    const other = join(tempProject(), "other.git");
    execFileSync("git", ["init", "-q", "--bare", other]);
    git(root, "remote", "set-url", "origin", other);
    const a = cli(["archive", ID]);
    expect(a.code, a.err).toBe(0);
    expect(a.out).not.toMatch(/pushed/);
    expect(git(other, "for-each-ref", "--format=%(refname)")).toBe("");
  });

  it("does not push with the grant when no pull request was opened", () => {
    approved();
    finished();
    packaged();
    const a = cli(["archive", ID]);
    expect(a.code, a.err).toBe(0);
    expect(a.out).not.toMatch(/pushed/);
    expect(git(bare, "for-each-ref", "--format=%(refname)")).toBe("");
  });

  it("pushes only the Change Branch, to the commit the archive made", () => {
    approved();
    finished();
    packaged();
    expect(cli(["pr", ID, "--create"]).code).toBe(0);
    const a = cli(["archive", ID]);
    expect(a.code, a.err).toBe(0);
    expect(git(bare, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/aidw/app");
    expect(git(bare, "rev-parse", "refs/heads/aidw/app")).toBe(git(root, "rev-parse", "aidw/app"));
  });
});

describe("the cap and resume", () => {
  it("`aidw cap` asks the lead in every form and is denied to every Agent", () => {
    approved();
    for (const cmd of ["aidw cap app --raise 5", "npx aidw cap app --raise 5", "node plugins/aidw/bin/aidw cap app --raise 5", "cd . && aidw cap app --raise 5"]) {
      expect([cmd, bash(cmd)]).toEqual([cmd, "ask"]);
      for (const agent of ["aidw:backend", "aidw:code-reviewer", "aidw:qa"]) expect([cmd, agent, bash(cmd, agent)]).toEqual([cmd, agent, "deny"]);
    }
  });

  it("resume is refused when what is left needs the user: work outside the grants", () => {
    approved();
    finished();
    setTasks((ts) => {
      ts[1]!.status = "not_built";
      ts[1]!.not_built = { cause: "envelope", reason: "needs a production database", at: "x" };
    });
    const t = cli(["transition", ID, "executing"]);
    expect(t.code).toBe(1);
    expect(t.err).toMatch(/nothing in "app" can run again/);
    expect(changeData().state).toBe("delivered");
  });

  it("resume is refused while the cap is reached, and goes through once the user raised it", () => {
    approved();
    finished();
    setChange((c) => (c.approval.agent_run_cap = 1));
    json("evidence/agent-runs.json", { runs: [{ key: "implementer:a", kind: "implementer", at: "x" }] });
    setTasks((ts) => {
      ts[1]!.status = "not_built";
      ts[1]!.not_built = { cause: "cap", reason: "the Agent-run cap was reached", at: "x" };
    });
    const refused = cli(["transition", ID, "executing"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/aidw cap app --raise/);
    expect(cli(["cap", ID, "--raise", "5"]).code).toBe(0);
    const t = cli(["transition", ID, "executing"]);
    expect(t.code, t.err).toBe(0);
    const tasks = (YAML.parse(readFileSync(join(changeDir(), "tasks.yaml"), "utf8")) as { tasks: Record<string, any>[] }).tasks;
    expect(tasks[1]).toMatchObject({ id: "T02", status: "pending" });
  });

  it("resume goes through for a failed deploy alone", () => {
    approved();
    finished({ deploy: { ok: false, url: null, error: "deploy command exited 1" } });
    const t = cli(["transition", ID, "executing"]);
    expect(t.code, t.err).toBe(0);
    expect(t.out).toMatch(/deploy runs again/);
  });
});

describe("the runner's exit code", () => {
  it("is 2 when the run ends in a draft", () => {
    root = tempProject();
    git(root, "init", "-q", "-b", "main");
    cli(["init"]);
    cli(["change", "new", ID]);
    write(root, `.aidw/changes/${ID}/tasks.yaml`, "tasks: []\n");
    setChange((c) => {
      c.state = "delivered";
      c.run = { paused: null };
    });
    const claude = write(
      root,
      "fake-claude",
      `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const f = path.join(process.cwd(), ".aidw/changes/${ID}/change.yaml");
const y = fs.readFileSync(f, "utf8");
if (!/^  pr:/m.test(y)) fs.writeFileSync(f, y.replace(/^run:\\n/m, "run:\\n  pr: { url: null, draft: true, at: x }\\n"));
`,
    );
    chmodSync(claude, 0o755);
    const r = cli(["run", ID, "--claude", claude, "--max-runs", "3", "--json"], { PATH: process.env.PATH });
    const out = JSON.parse(r.out) as { outcome: string; runs: number };
    expect(out.outcome, r.out + r.err).toBe("draft");
    expect(out.runs).toBe(1);
    expect(r.code).toBe(2);
  });
});
