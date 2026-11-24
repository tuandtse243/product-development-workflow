/** T11 re-review probes (uncommitted): archive --force, fork PRs in the gh pr list fallback, package v2, bookkeeping freshness. */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { computeApprovalHash } from "../src/approval.js";
import { loadChange, saveChange } from "../src/change.js";
import { pathsFor } from "../src/project.js";
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
const FORK_URL = "https://github.com/acme/app/pull/8";
const FAKE_GH = `#!/usr/bin/env node
const fs = require("fs");
const a = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(a) + "\\n");
const open = process.env.FAKE_GH_LOG + ".open";
const fork = { url: "${FORK_URL}", number: 8, isDraft: false, state: "OPEN", headRefName: "aidw/app", baseRefName: "main", isCrossRepository: true, headRepositoryOwner: { login: "stranger" } };
const ours = { url: "${PR_URL}", number: 7, isDraft: true, state: "OPEN", headRefName: "aidw/app", baseRefName: "main", isCrossRepository: false, headRepositoryOwner: { login: "acme" } };
if (a[0] === "pr" && a[1] === "create") { fs.writeFileSync(open, "1"); console.log("${PR_URL}"); }
if (a[0] === "pr" && a[1] === "list") console.log(JSON.stringify([...(process.env.FAKE_GH_FORK ? [fork] : []), ...(fs.existsSync(open) ? [ours] : [])]));
if (a[0] === "pr" && a[1] === "view") console.log(JSON.stringify(a[2] === "${FORK_URL}" ? fork : ours));
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

describe("T11 re-review probes", () => {
  it("(4) an unattended session never archives a draft as it is (--force is the user's call)", () => {
    approved();
    finished({ deploy: { ok: false, url: null, error: "vercel: not logged in" } });
    packaged();
    expect(cli(["archive", ID]).code).toBe(1); // a draft: refused without --force
    const r = cli(["archive", ID, "--force"], { AIDW_RUNNER: "1" });
    expect(r.code, r.out).toBe(1);
    expect(changeData().state).toBe("delivered");
  });

  it("(4) the gate asks the lead before `aidw archive --force` (the docs: only the user archives a draft as it is)", () => {
    approved();
    expect(bash(`aidw archive ${ID} --force`)).toBe("ask");
  });

  it("(3) never edits a fork's pull request that gh pr list returns for the same branch name", () => {
    approved();
    finished();
    process.env.FAKE_GH_FORK = "1";
    try {
      const r = cli(["pr", ID, "--create", "--json"]);
      expect(r.code, r.err).toBe(0);
      for (const c of ghCalls()) if (c[1] === "edit" || c[1] === "ready") expect(c).not.toContain(FORK_URL);
      expect(changeData().run.pr.url).toBe(PR_URL);
    } finally {
      delete process.env.FAKE_GH_FORK;
    }
  });

  it("(2) a version 2 approval stays valid after the upgrade (documents: its cap is not bound)", () => {
    approved();
    const p = pathsFor(root);
    const c = loadChange(p, ID);
    c.doc.setIn(["approval", "package"], 2);
    saveChange(c);
    const c2 = loadChange(p, ID);
    c2.doc.setIn(["approval", "hash"], computeApprovalHash(p, c2, undefined, { version: 2 }).hash);
    saveChange(c2);
    expect(cli(["approval", "check", ID]).code).toBe(0);
    setChange((d) => (d.approval.agent_run_cap = 999));
    // the old exposure: a v2 cap edit is not drift
    expect(cli(["approval", "check", ID]).code).toBe(0);
    // the first raise moves it to v3 and binds it
    expect(cli(["cap", ID, "--raise", "1"]).code).toBe(0);
    expect(changeData().approval.package).toBe(3);
    setChange((d) => (d.approval.agent_run_cap = 5000));
    expect(cli(["approval", "check", ID]).code).toBe(1);
  });

  it("(1) a .gitignore or README commit after verify keeps the results fresh (documents the rule)", () => {
    approved();
    finished();
    write(root, ".gitignore", "node_modules/\n");
    write(root, "README.md", "# app\n\nchanged\n");
    git(root, "add", ".gitignore", "README.md");
    git(root, "commit", "-q", "-m", "docs: readme");
    expect(readiness().ready).toBe(true);
    // a nested .gitignore is code, not bookkeeping
    write(root, "app/.gitignore", "x\n");
    git(root, "add", "app/.gitignore");
    git(root, "commit", "-q", "-m", "chore: nested ignore");
    expect(readiness().ready).toBe(false);
  });
});
