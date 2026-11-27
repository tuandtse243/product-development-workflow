/**
 * T14 (I8, Q5, M8, I11, M4): delivery. The Documentation Role's `delivery/pr-summary.md` goes into the pull request body
 * next to the generated Evidence, and `aidw pr` refuses it when it names a file that is neither in the git diff nor an
 * approved Artifact. `manual:` on a task lists checks that need a human; `aidw deliver` puts them under "Checks for
 * you" in the handoff. A local bare repository stands in for the remote and a fake `gh` answers; nothing leaves.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { checkEvals, loadEvalCases } from "../src/evals.js";
import { loadRole } from "../src/roles.js";
import { CHECKS_FOR_YOU, HANDOFF_SECTIONS, manualChecks, withChecksForYou } from "../src/deliver.js";
import { defaultBranch } from "../src/git.js";
import { mergeDanger } from "../src/pr.js";
import { pathsFor } from "../src/project.js";
import { summaryPaths, summaryRefs, unknownPaths } from "../src/prsummary.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, planReviewed, tempProject, write } from "./fixtures.js";

const ID = "app";
const GRANTS = "grants:\n  push:\n    remote: origin\n    base: main\n";
const PR_URL = "https://github.com/acme/app/pull/7";

let root: string;
const saved: Record<string, string | undefined> = {};

const FAKE_GH = `#!/usr/bin/env node
const fs = require("fs");
const a = process.argv.slice(2);
const open = process.env.FAKE_GH_LOG + ".open";
const pr = { url: "${PR_URL}", number: 7, isDraft: false, state: "OPEN", headRefName: "aidw/app", baseRefName: "main", isCrossRepository: false, headRepositoryOwner: { login: "acme" } };
if (a[0] === "pr" && a[1] === "create") { fs.writeFileSync(open, "1"); console.log("${PR_URL}"); }
if (a[0] === "pr" && a[1] === "view") { if (!fs.existsSync(open)) process.exit(1); console.log(JSON.stringify(pr)); }
if (a[0] === "pr" && a[1] === "list") console.log(JSON.stringify(fs.existsSync(open) ? [pr] : []));
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

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
const changeDir = () => join(root, ".aidw/changes", ID);
function setTasks(patch: (tasks: Record<string, any>[]) => void) {
  const f = join(changeDir(), "tasks.yaml");
  const d = YAML.parse(readFileSync(f, "utf8")) as { tasks: Record<string, any>[] };
  patch(d.tasks);
  writeFileSync(f, YAML.stringify(d));
}
const json = (rel: string, data: unknown) => write(root, `.aidw/changes/${ID}/${rel}`, `${JSON.stringify(data, null, 2)}\n`);

/** An approved Change (T01 with a manual check) whose Change Branch committed one route file, delivered and green. */
function delivered(tasks = TASKS_YAML.replace('    verify: ["pnpm vitest run lib/booking"]\n', '    verify: ["pnpm vitest run lib/booking"]\n    manual: ["a real phone receives the reschedule SMS"]\n')) {
  root = tempProject();
  const bare = join(tempProject(), "remote.git");
  process.env.FAKE_GH_LOG = join(root, "..", `gh-${Math.random().toString(36).slice(2)}.log`);
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
  write(root, `.aidw/changes/${ID}/tasks.yaml`, tasks);
  write(root, `.aidw/changes/${ID}/quality.yaml`, QUALITY_YAML + GRANTS);
  write(root, `.aidw/changes/${ID}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  planReviewed(root, ID);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(["transition", ID, s]).code).toBe(0);
  expect(cli(["approve", ID]).code).toBe(0);
  expect(cli(["transition", ID, "executing"]).code).toBe(0);
  write(root, "app/api/bookings/route.ts", "export async function PATCH() {}\n");
  git(root, "add", "app/api/bookings/route.ts");
  git(root, "commit", "-q", "-m", "feat(booking): reschedule route");
  setTasks((ts) => ts.forEach((t) => (t.status = "done")));
  const head = git(root, "rev-parse", "HEAD");
  const at = new Date().toISOString();
  json("evidence/quality/summary.json", { layers: Object.fromEntries(["code", "unit", "e2e"].map((n) => [n, { status: "pass", at, head, runs: [] }])) });
  json("evidence/converge.json", { runs: [{ at, head, mode: "presence", ok: true, scenarios: { "booking/reschedule-appointment/reschedule-appointment-works": { status: "pass", where: ["t.test.ts:1"] } }, added: [], not_built: [] }] });
  json("evidence/deploy.json", { runs: [{ at, target: "preview", ok: true, skipped: false, url: "https://app-preview.vercel.app", head, runs: [], smoke: [] }] });
  const c = YAML.parse(readFileSync(join(changeDir(), "change.yaml"), "utf8")) as Record<string, unknown>;
  c.state = "deploying";
  writeFileSync(join(changeDir(), "change.yaml"), YAML.stringify(c));
  expect(cli(["transition", ID, "delivered"]).code).toBe(0);
}

const SUMMARY = `# Reschedule an appointment

Patients move a booking themselves instead of calling the clinic.

## Why

Staff spent the morning moving bookings by phone; \`PATCH\` on the booking route lets the patient do it.

## Notes

- No migration: the slot table already had \`moved_from\` (see \`.aidw/changes/app/analysis.md\`).

## Change outline

\`\`\`tree
+ app/api/bookings/route.ts   the PATCH handler
\`\`\`

\`\`\`diff
// app/api/bookings/route.ts
+export async function PATCH() {}
\`\`\`

Folder \`app/api/\`, spec \`specs/booking/spec.md\`, route \`/api/bookings\`, package \`@scope/pkg\`, call \`process.env\`.
`;

describe("which paths a pull request summary names", () => {
  it("reads backticked paths, tree View lines and the file comment or git headers of other fenced blocks", () => {
    const text = [
      "See `src/a.ts:12-30`, `README.md`, `./lib/b.ts`, `docs/x.md#L3` and `src/`.",
      "Not paths: `npm test`, `/api/x`, `@types/node`, `https://x.dev/a.md`, `src/**/*.ts`, `process.env`, `v1.2`,",
      "`aidw/reschedule`, `origin/main`, `application/json`, `GET/POST`, `owner/repo`, `i/o`, [the docs](https://x.dev/a.md), [up](#why).",
      "A link: [the route](app/api/route.ts).",
      "```tree",
      "+ app/new.ts      new route",
      "~ app/old.ts",
      "- app/gone.ts",
      "```",
      "```ts",
      "// lib/repo.ts",
      "const notAPath = `x/y.ts`;",
      "```",
      "```diff",
      "diff --git a/c/d.ts b/c/d.ts",
      "--- a/c/d.ts",
      "+++ b/c/d.ts",
      "```",
    ].join("\n");
    expect(summaryPaths(text)).toEqual(["src/a.ts", "README.md", "lib/b.ts", "docs/x.md", "src/", "app/api/route.ts", "app/new.ts", "app/old.ts", "app/gone.ts", "lib/repo.ts", "c/d.ts"]);
  });

  it("does not read a command in backticks as a path, nor an anchor of a link target", () => {
    const text = "Run `node scripts/build.mjs`, `vitest run tests/pr-summary.test.ts`, `psql -f db/migrate.sql` and `npx tsx src/a.ts`; see [setup](README.md#setup) and `app/book now/page.tsx`.";
    expect(summaryPaths(text)).toEqual(["app/book now/page.tsx", "README.md"]);
  });

  it("marks a bare file name in prose as loose (never refused): it cannot be told from a product name", () => {
    expect(summaryRefs("Built on `Next.js` and `node.js`; see `README.md` and `lib/x.ts`.")).toEqual([
      { path: "Next.js", loose: true },
      { path: "node.js", loose: true },
      { path: "README.md", loose: true },
      { path: "lib/x.ts", loose: false },
    ]);
  });

  it("reads a diff whose first line is a git header as the header, not as a comment", () => {
    expect(summaryPaths(["```diff", "--- a/lib/old.ts", "+++ b/lib/old.ts", "@@ -1 +1 @@", "```"].join("\n"))).toEqual(["lib/old.ts"]);
  });

  it("drops box-drawing characters in a tree View", () => {
    expect(summaryPaths(["```tree", "│   ├── + app/a.ts   new", "└── ~ app/b.ts", "```"].join("\n"))).toEqual(["app/a.ts", "app/b.ts"]);
  });

  it("knows a folder when a known file lies under it", () => {
    const known = new Set(["app/api/bookings/route.ts"]);
    expect(unknownPaths(["app/", "app/api", "app/api/bookings/route.ts", "lib/", "app/api/ghost.ts"], known)).toEqual(["lib/", "app/api/ghost.ts"]);
  });
});

describe("aidw pr with the Documentation Role's summary (I8)", () => {
  it("puts the summary after the three fixed sections, without its title, and keeps the generated Evidence", () => {
    delivered();
    write(root, `.aidw/changes/${ID}/delivery/pr-summary.md`, SUMMARY);
    const r = cli(["pr", ID]);
    expect(r.code, r.err).toBe(0);
    const body = readFileSync(join(root, ".aidw/run/pr-app.md"), "utf8");
    const heads = [...body.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(heads).toEqual(["Why", "Notes", "Change outline", "Differs from the approved package", "Not built and why", "Needed from the user to finish", "Tasks", "Evidence", "Merge danger"]);
    expect(body).toContain("Patients move a booking themselves");
    expect(body).not.toContain("# Reschedule an appointment\n");
    expect(body).toMatch(/## Evidence\n\n- code: pass/);
    // I11, M4: the manual checks are listed for the user, and do not make the pull request a draft
    expect(body).toMatch(/## Needed from the user to finish\n\n- \[ \] T01 Booking API: a real phone receives the reschedule SMS\n/);
    expect(r.out).toMatch(/ready for review/);
    expect(r.out).not.toMatch(/WARNING/);
  });

  it("warns, without refusing, when a section of example 17 is missing", () => {
    delivered();
    write(root, `.aidw/changes/${ID}/delivery/pr-summary.md`, "# T\n\n## Why\n\nBecause.\n");
    const r = cli(["pr", ID]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/WARNING .*pr-summary\.md has no "## Notes" section/);
    expect(r.out).toMatch(/WARNING .*has no "## Change outline" section/);
  });

  it("refuses a summary that names files absent from the diff and the approved Artifacts, naming each", () => {
    delivered();
    write(root, `.aidw/changes/${ID}/delivery/pr-summary.md`, `${SUMMARY}\nAlso \`lib/ghost.ts\`.\n\n\`\`\`tree\n+ app/api/phantom.ts\n\`\`\`\n`);
    const r = cli(["pr", ID]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("`lib/ghost.ts`");
    expect(r.err).toContain("`app/api/phantom.ts`");
    expect(r.err).toMatch(/absent from the git diff \(main\.\.\.aidw\/app\) and from the approved Artifacts/);
    expect(r.err).not.toContain("`app/api/bookings/route.ts`");
  });

  it("accepts commands, product names and link anchors in the summary, and refuses a path that climbs with ..", () => {
    delivered();
    const ok = `${SUMMARY}\nBuilt on \`Next.js\`; run \`node scripts/build.mjs\` and \`psql -f db/migrate.sql\`; see [the route](app/api/bookings/route.ts#L1).\n`;
    write(root, `.aidw/changes/${ID}/delivery/pr-summary.md`, ok);
    const r = cli(["pr", ID]);
    expect(r.code, r.err).toBe(0);
    write(root, `.aidw/changes/${ID}/delivery/pr-summary.md`, `${ok}\nCopied from \`../shared/lock.ts\`.\n`);
    const bad = cli(["pr", ID]);
    expect(bad.code).not.toBe(0);
    expect(bad.err).toContain("`../shared/lock.ts`");
  });

  it("keeps the summary and warns when the git diff cannot be read (D12: the run still ends in a pull request)", () => {
    delivered();
    write(root, `.aidw/changes/${ID}/delivery/pr-summary.md`, `${SUMMARY}\nAlso \`lib/ghost.ts\`.\n`);
    git(root, "branch", "-D", "main");
    const r = cli(["pr", ID]);
    expect(r.code, r.err).toBe(0);
    expect(readFileSync(join(root, ".aidw/run/pr-app.md"), "utf8")).toContain("Patients move a booking themselves");
    expect(r.out).toMatch(/WARNING .*pr-summary\.md: the git diff \(main\.\.\.aidw\/app\) could not be read \(.+\), so the files it names were not checked: .*`lib\/ghost\.ts`/);
    expect(r.out).toContain("`app/api/bookings/route.ts`");
  });

  it("keeps the Analysis summary when there is no pr-summary.md", () => {
    delivered();
    const r = cli(["pr", ID]);
    expect(r.code, r.err).toBe(0);
    expect([...readFileSync(join(root, ".aidw/run/pr-app.md"), "utf8").matchAll(/^## (.+)$/gm)].map((m) => m[1])[3]).toBe("Summary");
  });

  it("still accepts the summary after the archive, where the Change's files have moved", () => {
    delivered();
    cli(["deliver", "--change", ID]);
    const handoff = HANDOFF_SECTIONS.map((s) => `## ${s}\n\nNone\n`).join("\n");
    write(root, `.aidw/changes/${ID}/delivery/handoff.md`, `# Handoff\n\n${handoff}`);
    write(root, `.aidw/changes/${ID}/delivery/pr-summary.md`, SUMMARY);
    write(root, `.aidw/changes/${ID}/delivery/screenshots/01-book.png`, "png");
    const d = cli(["deliver", "--change", ID]);
    expect(d.code, d.out + d.err).toBe(0);
    expect(cli(["pr", ID, "--create"]).code).toBe(0);
    const a = cli(["archive", ID]);
    expect(a.code, a.err).toBe(0);
    // the archive names the folder <date>-<id>; the summary still says .aidw/changes/app/analysis.md
    const archived = /archive\/(\d{4}-\d{2}-\d{2}-app)/.exec(a.out)?.[1] ?? "";
    expect(archived).not.toBe("");
    const r = cli(["pr", archived]);
    expect(r.code, r.err).toBe(0);
    expect(readFileSync(join(root, `.aidw/run/pr-${archived}.md`), "utf8")).toContain("## Change outline");
  });
});

describe("checks for you (I11, M4)", () => {
  it("lists each task's manual checks under Checks for you in the handoff, right after the Overview", () => {
    delivered();
    cli(["deliver", "--change", ID]); // exits 1: the fresh handoff still holds its TODO(aidw) placeholders
    const handoff = readFileSync(join(changeDir(), "delivery/handoff.md"), "utf8");
    const heads = [...handoff.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(heads.slice(0, 3)).toEqual(["Overview", CHECKS_FOR_YOU, "Run locally"]);
    expect(handoff).toContain("- [ ] T01 Booking API: a real phone receives the reschedule SMS");
    expect(readFileSync(join(changeDir(), "delivery/README.md"), "utf8")).toMatch(/checks for you \(1\)/);
  });

  it("keeps the agent's handoff and refreshes only the section; --check refuses a handoff that dropped a check", () => {
    delivered();
    cli(["deliver", "--change", ID]);
    const handoff = HANDOFF_SECTIONS.map((s) => `## ${s}\n\nNone\n`).join("\n");
    write(root, `.aidw/changes/${ID}/delivery/handoff.md`, `# Handoff\n\n${handoff}`);
    write(root, `.aidw/changes/${ID}/delivery/screenshots/01-book.png`, "png");
    const check = cli(["deliver", "--check", "--change", ID]);
    expect(check.code).not.toBe(0);
    expect(check.out + check.err).toMatch(/missing section "## Checks for you"/);
    cli(["deliver", "--change", ID]);
    const again = readFileSync(join(changeDir(), "delivery/handoff.md"), "utf8");
    expect(again).toContain("a real phone receives the reschedule SMS");
    expect(again).toContain("## Known issues\n\nNone");
    const ok = cli(["deliver", "--check", "--change", ID]);
    expect(ok.code, ok.out + ok.err).toBe(0);
  });

  it("leaves a not-built task's checks out and writes no section when no task has one", () => {
    expect(manualChecks([{ id: "T1", title: "a", status: "not_built", manual: ["x"] }, { id: "T2", title: "b", status: "done", manual: ["y"] }])).toEqual(["- [ ] T2 b: y"]);
    const h = "# Handoff\n\n## Overview\n\nIt books.\n\n## Run locally\n\npnpm dev\n";
    expect(withChecksForYou(h, [])).toBe(h);
    const once = withChecksForYou(h, ["- [ ] T2 b: y"]);
    expect(withChecksForYou(once, ["- [ ] T2 b: y"])).toBe(once);
    const ticked = once.replace("- [ ] T2 b: y", "- [x] T2 b: y");
    expect(withChecksForYou(ticked, ["- [ ] T2 b: y", "- [ ] T3 c: z"])).toMatch(/- \[x\] T2 b: y\n- \[ \] T3 c: z/);
    expect(withChecksForYou(ticked, ["- [ ] T2 b: y changed"])).toContain("- [ ] T2 b: y changed");
    expect(withChecksForYou("# H\n\n## Overview\n\nIt books.\n", ["- [ ] T2 b: y"])).toMatch(/It books\.\n\n## Checks for you\n/);
    expect(withChecksForYou(once, [])).toContain("## Checks for you\n\nNone: every check of the plan ran automatically.\n\n## Run locally");
  });

  it("leaves a fenced example of the headings alone", () => {
    const h = "# Handoff\n\n```md\n## Overview\n\n## Checks for you\n\n- [ ] example\n```\n\n## Overview\n\nIt books.\n\n## Run locally\n\npnpm dev\n";
    const out = withChecksForYou(h, ["- [ ] T2 b: y"]);
    expect(out).toContain("```md\n## Overview\n\n## Checks for you\n\n- [ ] example\n```");
    expect(out).toMatch(/It books\.\n\n## Checks for you\n\nThe plan left[^\n]*\n\n- \[ \] T2 b: y\n\n## Run locally/);
    expect(withChecksForYou(out, ["- [ ] T2 b: y"])).toBe(out);
  });

});

describe("the Documentation Role, its skill and the deliver skill say it (I8, M4, M7)", () => {
  const plugin = join(__dirname, "../plugins/aidw");
  const read = (...p: string[]) => readFileSync(join(plugin, ...p), "utf8");

  it("the Role lists pr-summary, writes the artifact, and its eval covers the skill with no error", () => {
    const role = loadRole(plugin, "documentation")!;
    expect(role.skills.map((s) => s.name)).toContain("pr-summary");
    expect(read("roles", "documentation", "role.md")).toMatch(/delivery\/pr-summary\.md/);
    const c = loadEvalCases(plugin, "documentation").cases.find((x) => x.covers.includes("pr-summary"));
    expect(c).toBeDefined();
    const errors = checkEvals(plugin).items.filter((i) => i.level === "error");
    expect(errors, JSON.stringify(errors)).toEqual([]);
    expect(YAML.parse(read("artifacts.yaml"))["pr-summary"]).toEqual({ path: "changes/<id>/delivery/pr-summary.md", owner: "documentation", validate: "aidw pr" });
  });

  it("the skill follows example 17 in its order and names its sources", () => {
    const skill = read("roles", "documentation", "skills", "pr-summary.md");
    const order = ["## Why", "## Notes", "## Change outline"].map((h) => skill.indexOf(`\`${h}\``));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(skill).toMatch(/17-pr-writeup/);
    expect(skill).toMatch(/## Sources[\s\S]*html-effectiveness[\s\S]*rpi/);
  });

  it("the deliver skill asks for the summary, explains the refusal and reports the checks for you", () => {
    const skill = read("skills", "deliver", "SKILL.md");
    expect(skill).toMatch(/pr-summary\.md as your pr-summary skill says/);
    expect(skill).toMatch(/refuses a summary that names a file\s+absent from the git diff/);
    expect(skill).toMatch(/## Checks for you/);
    expect(skill).toMatch(/`manual:`/);
  });
});

describe("the pull request body order, title and default branch (B5)", () => {
  it("opens with the summary, takes its H1 as the title, lists the manual check once and marks the task", () => {
    delivered();
    const withNote = SUMMARY.replace("## Notes\n\n", "## Notes\n\n- Still open: a real phone receives the reschedule SMS.\n");
    write(root, `.aidw/changes/${ID}/delivery/pr-summary.md`, withNote);
    const r = cli(["pr", ID]);
    expect(r.code, r.err).toBe(0);
    const body = readFileSync(join(root, ".aidw/run/pr-app.md"), "utf8");
    expect(body.startsWith("Patients move a booking themselves")).toBe(true);
    expect(body.indexOf("## Differs from the approved package")).toBeGreaterThan(body.indexOf("## Change outline"));
    expect(body.match(/a real phone receives the reschedule SMS/g)).toHaveLength(1);
    expect(body).toMatch(/## Needed from the user to finish\n\n- \[ \] T01 .*a real phone receives/);
    expect(body).toMatch(/- T01 Booking API \(manual check open\)/);
    expect(body).not.toMatch(/T01 Booking API \(done\)/);
    expect(r.out).toContain("title: feat(booking): reschedule an appointment");
  });

  it("names the repository's real default branch, never the literal main", () => {
    delivered();
    git(root, "branch", "-m", "main", "master");
    git(root, "switch", "-q", "aidw/app");
    const p = pathsFor(root);
    expect(defaultBranch(root, "x")).toBe("master");
    git(root, "branch", "side");
    git(root, "switch", "-q", "side");
    git(root, "commit", "-q", "--allow-empty", "-m", "side work");
    git(root, "switch", "-q", "aidw/app");
    expect(mergeDanger(p, ID, [], "side", "aidw/app")[0]).toMatch(/Base branch side is not merged into master/);
    // no main or master at all: the branch the Change started from
    git(root, "branch", "-m", "master", "trunk2");
    git(root, "config", "init.defaultBranch", "nonexistent");
    expect(defaultBranch(root, "started")).toBe("started");
  });
});

describe("delivery leaves a clean tree (B6)", () => {
  it("commits the README and API docs the delivery wrote, so archive finds nothing extra", () => {
    delivered();
    write(root, "README.md", "# app\n\nNow with the reschedule route.\n");
    write(root, "docs/api.md", "# API\n\nPATCH /api/bookings\n");
    cli(["deliver", "--change", ID]);
    write(root, `.aidw/changes/${ID}/delivery/handoff.md`, `# Handoff\n\n${HANDOFF_SECTIONS.map((s) => `## ${s}\n\nNone\n`).join("\n")}`);
    write(root, `.aidw/changes/${ID}/delivery/screenshots/01-book.png`, "png");
    write(root, "README.md", "# app\n\nNow with the reschedule route, take two.\n");
    const d = cli(["deliver", "--change", ID]);
    expect(d.code, d.out + d.err).toBe(0);
    expect(git(root, "status", "--porcelain", "--", ".", ":(exclude).aidw/run")).toBe("");
    const a = cli(["archive", ID, "--force"], {});
    expect(a.out).not.toMatch(/also committed with it/);
  });
});
