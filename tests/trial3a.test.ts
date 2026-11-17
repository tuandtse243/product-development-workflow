/**
 * Regressions found by trial-3A (docs/trial-3.md): worktrees without node_modules, a layer passing without its
 * JUnit report, a UI scenario owned only by an API task, and the pnpm store in the project root.
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TOKENS_YAML, tempProject, write } from "./fixtures.js";

const ID = "2026-11-12-t3a";
const SCENARIO = "booking/reschedule-appointment/reschedule-appointment-works";

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}
const g = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();

function project(opts: { quality?: string; spec?: string; tasks?: string; git?: boolean } = {}): string {
  const root = tempProject();
  cli(root, "init");
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  cli(root, "change", "new", ID);
  const c = `.aidw/changes/${ID}`;
  write(root, `${c}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `${c}/specs/booking/spec.md`, opts.spec ?? `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  write(
    root,
    `${c}/tasks.yaml`,
    opts.tasks ??
      `tasks:\n  - id: T01\n    title: Reschedule\n    role: backend-engineer\n    type: feat\n    scenarios: [${SCENARIO}]\n    touches: ["lib/**", "tests/**"]\n    verify: ['node -e "process.exit(0)"']\n    status: pending\n`,
  );
  write(root, `${c}/quality.yaml`, opts.quality ?? QUALITY_YAML);
  if (opts.git) {
    g(root, "init", "-q");
    g(root, "config", "user.email", "t@t");
    g(root, "config", "user.name", "t");
    write(root, ".gitignore", "node_modules/\n");
    g(root, "add", "-A");
    g(root, "commit", "-qm", "base");
  }
  return root;
}

function approve(root: string) {
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).err).toBe("");
  expect(cli(root, "approve", ID).code).toBe(0);
  expect(cli(root, "transition", ID, "executing").code).toBe(0);
}

describe("trial-3A regressions", () => {
  it("links the main node_modules into a task worktree without staging it", () => {
    const root = project({ git: true });
    write(root, "node_modules/.bin/vitest", "#!/bin/sh\n");
    approve(root);
    const s = cli(root, "task", "start", "T01", "--worktree", "--json").json();
    const wt = join(root, s.worktree);
    expect(lstatSync(join(wt, "node_modules")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(wt, "node_modules/.bin/vitest"))).toBe(true);
    write(wt, "lib/x.js", "1;\n");
    expect(g(wt, "status", "--porcelain")).toBe("?? lib/");
    // a resumed task gets the link again
    execFileSync("rm", [join(wt, "node_modules")]);
    cli(root, "task", "start", "T01", "--worktree");
    expect(existsSync(join(wt, "node_modules"))).toBe(true);
  });

  it("fails a layer whose command passed but whose declared JUnit report is missing", () => {
    const q = `layers:\n  - name: code\n    run: ['node -e "process.exit(0)"']\n  - name: unit\n    run: ['node -e "process.exit(0)"']\n    reports: [test-results/unit.xml]\n  - name: e2e\n    run: ['node -e "process.exit(0)"']\ndeploy:\n  target: none\n`;
    const root = project({ quality: q });
    write(root, "tests/a.test.ts", `test("${SCENARIO}: works", () => {})\n`);
    approve(root);
    cli(root, "task", "start", "T01");
    expect(cli(root, "checkpoint", "T01").out).toMatch(/^PASS/);
    expect(cli(root, "review", "T01", "pass").code).toBe(0);
    expect(cli(root, "transition", ID, "verifying").code).toBe(0);
    const v = cli(root, "verify", "--json");
    expect(v.code).toBe(1);
    expect(v.json()).toMatchObject({ ok: false, failed: "unit" });
    const task = readFileSync(join(root, ".aidw/changes", ID, "tasks.yaml"), "utf8");
    expect(task).toMatch(/wrote no JUnit report test-results\/unit\.xml/);
  });

  it("warns when a scenario triggered from the UI belongs only to a task that touches no UI", () => {
    const spec = `## ADDED Requirements\n\n### Requirement: Export csv\nThe system SHALL download a CSV.\n\n#### Scenario: Whole month\n- **WHEN** the user clicks "Export CSV" on the list screen\n- **THEN** the file is downloaded\n`;
    const sid = "booking/export-csv/whole-month";
    const api = `tasks:\n  - id: T01\n    title: Export api\n    role: backend-engineer\n    type: feat\n    specs: [booking/export-csv]\n    scenarios: [${sid}]\n    touches: ["lib/csv.ts", "app/api/export/**"]\n    verify: ['node -e "process.exit(0)"']\n    status: pending\n`;
    const warn = (tasks: string) => cli(project({ spec, tasks }), "analyze", ID, "--json").out;
    expect(warn(api)).toMatch(/triggered from the UI[\s\S]*T01 touch no UI files/);
    expect(warn(api.replace('"app/api/export/**"', '"components/export-button.tsx"'))).not.toMatch(/triggered from the UI/);
    expect(warn(api.replace("node -e", "pnpm exec playwright test #"))).not.toMatch(/triggered from the UI/);
  });

  it("refuses to commit the pnpm store the sandbox puts in the project root", () => {
    const root = project({ git: true });
    approve(root);
    cli(root, "task", "start", "T01");
    write(root, ".pnpm-store/v3/files/00/abc", "x");
    write(root, "tests/a.test.ts", `test("${SCENARIO}: works", () => {})\n`);
    expect(cli(root, "checkpoint", "T01").out).toMatch(/^PASS/);
    const r = cli(root, "review", "T01", "pass");
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/refusing to commit dependency or build output \(\.pnpm-store/);
  });
});

import { deployHint } from "../src/quality.js";

describe("deploy hints", () => {
  it("explains the sandbox network block and the first-deploy-is-production rule", () => {
    expect(deployHint("Error: An unexpected error occurred in deploy: TypeError: fetch failed")).toMatch(/sandbox blocked the network/);
    expect(deployHint("Error: Can't create a Preview deployment. This project has no deployments yet")).toMatch(/aidw first-deploy --yes/);
  });
});

describe("re-approval keeps done work and tasks can be reopened", () => {
  const TWO = `tasks:
  - id: T01
    title: First
    role: backend-engineer
    type: feat
    scenarios: [${SCENARIO}]
    touches: ["lib/a/**"]
    verify: ['node -e "process.exit(0)"']
    status: pending
  - id: T02
    title: Second
    role: backend-engineer
    type: feat
    depends_on: [T01]
    touches: ["lib/b/**"]
    verify: ['node -e "process.exit(0)"']
    status: pending
`;
  const complete = (root: string, t: string, file: string) => {
    cli(root, "task", "start", t);
    write(root, file, "1;\n");
    if (t === "T01") write(root, "tests/t01.test.ts", `test("${SCENARIO}: works", () => {})\n`);
    expect(cli(root, "checkpoint", t).out).toMatch(/^PASS/);
    expect(cli(root, "review", t, "pass").code).toBe(0);
  };
  const tasksOf = (root: string) => readFileSync(join(root, ".aidw/changes", ID, "tasks.yaml"), "utf8");

  it("keeps an unchanged done task and reruns an edited one after re-approval", () => {
    const root = project({ git: true, tasks: TWO });
    approve(root);
    complete(root, "T01", "lib/a/x.js");
    complete(root, "T02", "lib/b/y.js");
    expect(cli(root, "transition", ID, "escalated").code).toBe(0);
    expect(cli(root, "transition", ID, "analyzing").code).toBe(0);
    write(root, `.aidw/changes/${ID}/tasks.yaml`, tasksOf(root).replace("title: Second", "title: Second, changed"));
    for (const s of ["awaiting_approval"]) expect(cli(root, "transition", ID, s).err).toBe("");
    const r = cli(root, "approve", ID, "--json").json();
    expect(r).toMatchObject({ kept: ["T01"], reopened: ["T02"] });
    expect(tasksOf(root)).toMatch(/id: T01[\s\S]*status: done[\s\S]*id: T02[\s\S]*status: pending/);
  });

  it("reopens a done task, optionally reverting its commit", () => {
    const root = project({ git: true, tasks: TWO });
    approve(root);
    complete(root, "T01", "lib/a/x.js");
    expect(cli(root, "task", "reopen", "T02").err).toMatch(/only done tasks can be reopened/);
    const r = cli(root, "task", "reopen", "T01", "--revert", "--json").json();
    expect(r).toMatchObject({ ok: true, task: "T01", dependents: [] });
    expect(existsSync(join(root, "lib/a/x.js"))).toBe(false);
    expect(g(root, "log", "-1", "--format=%s")).toBe("revert(config): first");
    expect(tasksOf(root)).toMatch(/id: T01[\s\S]*status: pending/);
    expect(cli(root, "next", "--json").json()).toMatchObject({ action: "implement", task: "T01" });
  });
});

describe("small changes", () => {
  const withSize = (root: string, line: string) => {
    const f = join(root, ".aidw/changes", ID, "analysis.md");
    write(root, `.aidw/changes/${ID}/analysis.md`, readFileSync(f, "utf8").replace("## Summary\n", `## Summary\n\n${line}\n`));
  };
  const four = Array.from({ length: 4 }, (_, i) => `  - id: T0${i + 1}\n    title: t${i + 1}\n    role: backend-engineer\n    type: ${i === 0 ? "fix" : "feat"}\n${i === 0 ? `    scenarios: [${SCENARIO}]\n` : ""}    touches: ["lib/${i}/**"]\n    verify: ['node -e "process.exit(0)"']\n    status: pending\n`).join("");

  it("limits Size: small to three tasks and flags extra layers and a deploy", () => {
    const root = project({ tasks: `tasks:\n${four}` });
    withSize(root, "Size: small");
    const r = cli(root, "analyze", ID, "--json").out;
    expect(r).toMatch(/at most 3 tasks \(4 planned\)/);
    expect(r).toMatch(/does not deploy unless the user asked/);
  });

  it("rejects an unknown size and accepts normal", () => {
    const root = project();
    withSize(root, "Size: huge");
    expect(cli(root, "analyze", ID, "--json").out).toMatch(/invalid \\"Size:\\" line/);
    const ok = project();
    withSize(ok, "Size: normal");
    expect(cli(ok, "analyze", ID, "--json").out).not.toMatch(/Size/);
  });

  it("tells a bugfix implementer to write a failing regression test first", () => {
    const root = project({ tasks: `tasks:\n${four.split("  - id: T02")[0]}` });
    approve(root);
    cli(root, "task", "start", "T01");
    expect(readFileSync(cli(root, "brief", "T01").out.trim(), "utf8")).toMatch(/regression test[^\n]*FAIL on the current code/);
  });
});

import { ASK_COMMANDS, AIDW_STATE_COMMAND, firstMatch } from "../src/policy.js";

describe("pull request at delivery", () => {
  it("prints a PR built from the Analysis, tasks, evidence and the diff", () => {
    const root = project({ git: true });
    write(root, ".env.example", "A=1\n");
    g(root, "add", "-A");
    g(root, "commit", "-qm", "base");
    approve(root);
    g(root, "switch", "-q", "-c", "scratch");
    g(root, "switch", "-q", `aidw/${ID}`);
    write(root, ".env.example", "A=1\nNEW_KEY=\n");
    write(root, "db/migrations/001.sql", "select 1;\n");
    write(root, "package.json", "{}\n");
    g(root, "add", "-A");
    g(root, "commit", "-qm", "work");
    const r = cli(root, "pr", ID, "--base", "master", "--json").json();
    expect(r.title).toMatch(/^feat\(config\): \S/);
    expect(r.head).toBe(`aidw/${ID}`);
    expect(r.body).toMatch(/## Summary[\s\S]*## Tasks[\s\S]*T01 Reschedule[\s\S]*## Evidence[\s\S]*## Merge danger/);
    expect(r.body).toMatch(/Database migrations \(1\): db\/migrations\/001\.sql/);
    expect(r.body).toMatch(/New environment variables[^\n]*NEW_KEY/);
    expect(r.body).toMatch(/Dependencies changed: package\.json/);
    expect(r.commands[1]).toMatch(/^gh pr create --base master --head aidw\//);
    expect(cli(root, "pr", ID, "--create").err).toMatch(/open the PR after delivery/);
  });

  it("asks before pushing or opening a PR and keeps it from subagents", () => {
    expect(firstMatch(ASK_COMMANDS, "aidw pr --create --draft")).toBeDefined();
    expect(firstMatch(ASK_COMMANDS, "gh pr create --title x")).toBeDefined();
    expect(firstMatch(ASK_COMMANDS, "aidw pr")).toBeUndefined();
    expect(AIDW_STATE_COMMAND.test("aidw pr --create")).toBe(true);
  });
});

describe("migration rule", () => {
  it("warns when a task touches migrations without risk: high", () => {
    const task = (risk: string) => `tasks:\n  - id: T01\n    title: Add column\n    role: database-engineer\n    type: feat\n    scenarios: [${SCENARIO}]\n    touches: ["db/migrations/**", "lib/**"]\n${risk}    verify: ['node -e "process.exit(0)"']\n    status: pending\n`;
    expect(cli(project({ tasks: task("") }), "analyze", ID, "--json").out).toMatch(/touches database migrations but is not \\"risk: high\\"/);
    expect(cli(project({ tasks: task("    risk: high\n") }), "analyze", ID, "--json").out).not.toMatch(/database migrations/);
  });

  it("only a database task may change the schema or migrations (the notes-app scaffold made the tables itself)", () => {
    const task = (id: string, role: string, touches: string, extra = "") =>
      `  - id: ${id}\n    title: ${id} work\n    role: ${role}\n    type: feat\n    scenarios: [${SCENARIO}]\n    touches: [${touches}]\n${extra}    verify: ['node -e "process.exit(0)"']\n    status: pending\n`;
    const out = (tasks: string) => cli(project({ tasks: `tasks:\n${tasks}` }), "analyze", ID, "--json").out;

    // the scaffold touches Drizzle's folder and the schema file: neither was recognized as a migration before
    const folded = out(task("T01", "fullstack", '"package.json", "drizzle.config.ts", "drizzle/**", "src/db/schema.ts"', "    risk: high\n"));
    expect(folded).toMatch(/task T01 changes the database schema or migrations \(touches \\"drizzle\/\*\*\\", \\"src\/db\/schema\.ts\\"\) but its role is \\"fullstack\\"/);
    expect(folded).toMatch(/always its own task, owned by \\"database\\"/);

    // divided as the planner is told: scaffold, then the database task, then the code that uses the tables
    const divided =
      task("T01", "fullstack", '"package.json", "drizzle.config.ts", "src/db/client.ts"') +
      task("T02", "database", '"src/db/schema.ts", "drizzle/**", "tests/db/**"', "    risk: high\n    depends_on: [T01]\n") +
      task("T03", "fullstack", '"src/db/notes.ts", "src/lib/**", "tests/unit/**"', "    depends_on: [T02]\n");
    expect(out(divided)).not.toMatch(/changes the database schema|but also touches UI or API/);

    // a database task keeps to the database
    const mixed = out(task("T02", "database", '"drizzle/**", "src/app/page.tsx"', "    risk: high\n"));
    expect(mixed).toMatch(/task T02 is owned by \\"database\\" but also touches UI or API files/);
  });

  it("is in the profile and both reviewers", () => {
    const plugin = join(__dirname, "..", "plugins", "aidw");
    const read = (f: string) => readFileSync(join(plugin, f), "utf8");
    expect(read("roles/qa/references/quality-layers.md")).toMatch(/## Database migrations[\s\S]*reversible[\s\S]*seeded database/);
    expect(read("agents/code-reviewer.md")).toMatch(/Migrations in the diff must be reversible/);
    expect(read("agents/security.md")).toMatch(/Migrations:/);
  });
});

describe("token optimizations", () => {
  const plugin = join(__dirname, "..", "plugins", "aidw");
  const front = (f: string) => /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(plugin, f), "utf8"))?.[1] ?? "";

  it("the implementer has a tool allowlist and reviewers run on sonnet", () => {
    expect(front("agents/fullstack.md")).toMatch(/^tools: Read, Write, Edit, Glob, Grep, Bash$/m);
    expect(front("agents/fullstack.md")).not.toMatch(/disallowedTools/);
    for (const r of ["code-reviewer", "ui-ux-designer", "security"]) expect(front(`agents/${r}.md`)).toMatch(/^model: sonnet$/m);
  });

  it("auto-reviews a quality fix whose layer has its own reviewer, but not other fixes", () => {
    const q = `layers:\n  - name: code\n    run: ['node -e "process.exit(0)"']\n  - name: ui-ux\n    run: ['node -e "process.exit(0)"']\n    review: ui\n    artifacts: ["shots/*.png"]\n  - name: e2e\n    run: ['node -e "process.exit(0)"']\ndeploy:\n  target: none\n`;
    const root = project({ quality: q, git: true });
    approve(root);
    const tf = join(root, ".aidw/changes", ID, "tasks.yaml");
    const fix = (layer: string, id: string) => `  - id: ${id}\n    title: Fix ${layer}\n    role: fullstack-engineer\n    origin: quality\n    layer: ${layer}\n    touches: ["**"]\n    verify: ['node -e "process.exit(0)"']\n    status: pending\n`;
    write(root, `.aidw/changes/${ID}/tasks.yaml`, `${readFileSync(tf, "utf8")}${fix("ui-ux", "Q01")}${fix("code", "Q02")}`);
    for (const t of ["Q01", "Q02"]) {
      cli(root, "task", "start", t);
      write(root, `lib/${t}.js`, "1;\n");
    }
    expect(cli(root, "checkpoint", "Q01").out).toMatch(/auto-passed/);
    expect(readFileSync(tf, "utf8")).toMatch(/id: Q01[\s\S]*status: done/);
    expect(cli(root, "checkpoint", "Q02").out).toMatch(/^PASS/);
    expect(readFileSync(tf, "utf8")).toMatch(/id: Q02[\s\S]*status: review/);
  });
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { parallelSavings } from "../src/cost.js";
import { doctor, otherPlugins } from "../src/doctor.js";
import { pathsFor } from "../src/project.js";

describe("measuring and warning", () => {
  it("doctor warns when many other plugins ride along in every turn", () => {
    const home = mkdtempSync(join(tmpdir(), "aidw-home-"));
    write(home, "settings.json", JSON.stringify({ enabledPlugins: { "aidw@aidw": true, "a@x": true, "b@x": true, "c@x": true, "d@x": false } }));
    expect(otherPlugins({ CLAUDE_CONFIG_DIR: home })).toEqual(["a", "b", "c"]);
    const root = project();
    const checks = doctor(pathsFor(root), null, { CLAUDE_CONFIG_DIR: home }, () => ({ ok: true, out: "" }));
    expect(checks.find((c) => c.name === "token overhead")).toMatchObject({ status: "warn" });
    expect(doctor(pathsFor(root), null, { CLAUDE_CONFIG_DIR: tmpdir() + "/none" }, () => ({ ok: true, out: "" })).some((c) => c.name === "token overhead")).toBe(false);
  });

  it("parallelSavings compares serial task time with the time the waves covered", () => {
    const t = (a: string, b: string, merged = true) => ({ started_at: `2026-11-12T00:${a}:00Z`, finished_at: `2026-11-12T00:${b}:00Z`, ...(merged ? { merged_at: "x" } : {}) });
    const r = parallelSavings([t("00", "10"), t("00", "10"), t("20", "25"), t("30", "40", false)]);
    expect(r).toEqual({ wave: 3, serialMs: 25 * 60000, wallMs: 15 * 60000 });
    expect(parallelSavings([t("00", "05", false)])).toBeNull();
  });
});
