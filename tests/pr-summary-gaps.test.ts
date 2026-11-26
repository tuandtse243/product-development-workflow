/**
 * T14 gaps (I8, Q5, M8, I11, M4): the edges of the pull request summary check and of "Checks for you" that
 * pr-summary.test.ts leaves open. Path recognition on realistic summaries (Windows paths, spaces, `./`, `../`, Next.js
 * route folders, renames, box-drawn trees), a package version 4 Change naming its Program Design, repeated
 * `aidw deliver` runs, a task that turns not built, and a bugfix Change without a summary. A local bare repository
 * stands in for the remote and a fake `gh` answers; nothing leaves.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { CHECKS_FOR_YOU, HANDOFF_SECTIONS } from "../src/deliver.js";
import { summaryPaths } from "../src/prsummary.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, planReviewed, tempProject, write } from "./fixtures.js";

const ID = "app";
const GRANTS = "grants:\n  push:\n    remote: origin\n    base: main\n";
const PR_URL = "https://github.com/acme/app/pull/7";
const MANUAL = '    verify: ["pnpm vitest run lib/booking"]\n    manual: ["a real phone receives the reschedule SMS"]\n';
const WITH_MANUAL = TASKS_YAML.replace('    verify: ["pnpm vitest run lib/booking"]\n', MANUAL);

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
const readYaml = (rel: string) => YAML.parse(readFileSync(join(changeDir(), rel), "utf8")) as Record<string, any>;
const writeYaml = (rel: string, d: unknown) => writeFileSync(join(changeDir(), rel), YAML.stringify(d));
function setTasks(patch: (tasks: Record<string, any>[]) => void) {
  const d = readYaml("tasks.yaml") as { tasks: Record<string, any>[] };
  patch(d.tasks);
  writeYaml("tasks.yaml", d);
}
const json = (rel: string, data: unknown) => write(root, `.aidw/changes/${ID}/${rel}`, `${JSON.stringify(data, null, 2)}\n`);

/**
 * An approved Change whose Change Branch committed the route file, plus `lib/old.ts` on main that the branch renames to
 * `lib/new.ts` and `lib/gone.ts` that it deletes, and a Next.js page under a route group and a dynamic segment.
 */
function delivered(tasks = WITH_MANUAL) {
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
  write(root, "lib/old.ts", "export const old = 1;\nexport const keep = 2;\nexport const more = 3;\n");
  write(root, "lib/gone.ts", "export const gone = 1;\n");
  git(root, "add", "lib");
  git(root, "commit", "-q", "-m", "chore: lib");
  expect(cli(["transition", ID, "executing"]).code).toBe(0);
  write(root, "app/api/bookings/route.ts", "export async function PATCH() {}\n");
  write(root, "app/(site)/book/[id]/page.tsx", "export default function Page() { return null; }\n");
  git(root, "add", "app");
  git(root, "mv", "lib/old.ts", "lib/new.ts");
  git(root, "rm", "-q", "lib/gone.ts");
  git(root, "commit", "-q", "-m", "feat(booking): reschedule route");
  setTasks((ts) => ts.forEach((t) => (t.status = "done")));
  const head = git(root, "rev-parse", "HEAD");
  const at = new Date().toISOString();
  json("evidence/quality/summary.json", { layers: Object.fromEntries(["code", "unit", "e2e"].map((n) => [n, { status: "pass", at, head, runs: [] }])) });
  json("evidence/converge.json", { runs: [{ at, head, mode: "presence", ok: true, scenarios: { "booking/reschedule-appointment/reschedule-appointment-works": { status: "pass", where: ["t.test.ts:1"] } }, added: [], not_built: [] }] });
  json("evidence/deploy.json", { runs: [{ at, target: "preview", ok: true, skipped: false, url: "https://app-preview.vercel.app", head, runs: [], smoke: [] }] });
  const c = readYaml("change.yaml");
  c.state = "deploying";
  writeYaml("change.yaml", c);
  expect(cli(["transition", ID, "delivered"]).code).toBe(0);
}

const summary = (outline: string, extra = "") => `# Reschedule

Patients move a booking themselves.

## Why

Staff moved bookings by phone.

## Notes

- Nothing beyond the plan.${extra}

## Change outline

\`\`\`tree
${outline}
\`\`\`
`;

function pr(text: string) {
  write(root, `.aidw/changes/${ID}/delivery/pr-summary.md`, text);
  return cli(["pr", ID]);
}

describe("path recognition on realistic summaries (I8)", () => {
  it("reads a Windows path and a ./ path, and not /dev/null of a new-file diff", () => {
    const text = ["Moved `src\\lib\\old.ts`, see `./app/x.ts`.", "```diff", "--- /dev/null", "+++ b/app/new.ts", "```"].join("\n");
    const paths = summaryPaths(text);
    expect(paths).toEqual(["src\\lib\\old.ts", "app/x.ts", "app/new.ts"]);
  });

  it("reads the paths of a tree drawn with box-drawing characters", () => {
    const text = ["```tree", "├── app/api/bookings/route.ts   the handler", "└── app/ghost.ts                never written", "```"].join("\n");
    expect(summaryPaths(text)).toEqual(["app/api/bookings/route.ts", "app/ghost.ts"]);
  });
});

describe("aidw pr checks the paths against the diff and the approved package (I8)", () => {
  it("accepts a renamed file under both names, a deleted file, a Next.js route group page, a folder and path:line", () => {
    delivered();
    const r = pr(
      summary(
        [
          "+ app/api/bookings/route.ts        PATCH",
          "+ app/(site)/book/[id]/page.tsx    the page",
          "~ lib/new.ts                       renamed from lib/old.ts",
          "- lib/gone.ts                      removed",
        ].join("\n"),
        "\n- Review `app/api/bookings/route.ts:1` and the folder `app/api/`.",
      ),
    );
    expect(r.code, r.err).toBe(0);
  });

  it("accepts the old name of a file the Change Branch renamed", () => {
    delivered();
    const r = pr(summary("~ lib/new.ts   renamed", "\n- `lib/old.ts` became `lib/new.ts`."));
    expect(r.code, r.err).toBe(0);
  });

  it("refuses a ../ path: a file outside the repository is never inside the diff", () => {
    delivered();
    const r = pr(summary("+ app/api/bookings/route.ts   PATCH", "\n- Copied from `../other-repo/lib/lock.ts`."));
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("../other-repo/lib/lock.ts");
  });

  it("refuses a ../ path that climbs back into the repository to a real file", () => {
    delivered();
    const back = `../${root.split("/").at(-1)}/app/api/bookings/route.ts`;
    const r = pr(summary(`+ ${back}   PATCH`));
    expect(r.code).not.toBe(0);
    expect(r.err).toContain(back);
  });

  it("refuses a path that climbs out through ..", () => {
    delivered();
    const r = pr(summary("+ app/api/bookings/route.ts   PATCH", "\n- See `app/../../secrets.ts`."));
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("app/../../secrets.ts");
  });

  it("refuses an invented file whose name has a space", () => {
    delivered();
    const r = pr(summary("+ app/api/bookings/route.ts   PATCH", "\n- The copy lives in `app/book now/page.tsx`."));
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("book now");
  });

  it("refuses an invented file written with Windows separators", () => {
    delivered();
    const r = pr(summary("+ app/api/bookings/route.ts   PATCH", "\n- See `lib\\ghost.ts`."));
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("ghost.ts");
  });

  it("refuses an invented file drawn in a box-drawing tree", () => {
    delivered();
    const r = pr(summary("├── app/api/bookings/route.ts   PATCH\n└── lib/booking/lock.ts         the slot lock"));
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("lib/booking/lock.ts");
  });

  it("does not take a folder name that is only a prefix of a real folder", () => {
    delivered();
    const r = pr(summary("+ app/api/bookings/route.ts   PATCH", "\n- Folder `app/api/book/`."));
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("`app/api/book/`");
  });

  it("a package version 4 Change may name its approved program-design.md, by project path or Change path", () => {
    delivered();
    expect(readYaml("change.yaml").approval?.package).toBe(4);
    const r = pr(summary("+ app/api/bookings/route.ts   PATCH", "\n- As `.aidw/changes/app/program-design.md` drew it (`program-design.md`)."));
    expect(r.code, r.err).toBe(0);
  });

  it("refuses an Artifact of the Change folder that is not in the approved package", () => {
    delivered();
    write(root, `.aidw/changes/${ID}/notes-draft.md`, "x\n");
    const r = pr(summary("+ app/api/bookings/route.ts   PATCH", "\n- See `.aidw/changes/app/notes-draft.md`."));
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("notes-draft.md");
  });

  it("a bugfix Change without pr-summary.md keeps the Analysis summary where it was", () => {
    delivered();
    const c = readYaml("change.yaml");
    c.workflow = "bugfix";
    writeYaml("change.yaml", c);
    const r = cli(["pr", ID]);
    expect(r.code, r.err).toBe(0);
    const body = readFileSync(join(root, ".aidw/run/pr-app.md"), "utf8");
    const heads = [...body.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(heads.slice(3)).toEqual(["Summary", "Tasks", "Evidence", "Merge danger"]);
    expect(body).toContain("Clinic booking app.");
  });
});

describe("Checks for you over repeated deliver runs (I11, M4)", () => {
  const handoff = () => readFileSync(join(changeDir(), "delivery/handoff.md"), "utf8");
  const count = (s: string, x: string) => s.split(x).length - 1;
  const filled = () => write(root, `.aidw/changes/${ID}/delivery/handoff.md`, `# Handoff\n\n${HANDOFF_SECTIONS.map((s) => `## ${s}\n\nNone\n`).join("\n")}`);

  it("three runs leave one section with one line per check", () => {
    delivered();
    for (let i = 0; i < 3; i++) cli(["deliver", "--change", ID]);
    const h = handoff();
    expect(count(h, `## ${CHECKS_FOR_YOU}`)).toBe(1);
    expect(count(h, "a real phone receives the reschedule SMS")).toBe(1);
  });

  it("refreshes the section where the agent moved it, without adding a second one", () => {
    delivered();
    cli(["deliver", "--change", ID]);
    filled();
    write(root, `.aidw/changes/${ID}/delivery/handoff.md`, `${handoff()}\n## ${CHECKS_FOR_YOU}\n\nold line\n`);
    cli(["deliver", "--change", ID]);
    const h = handoff();
    expect(count(h, `## ${CHECKS_FOR_YOU}`)).toBe(1);
    expect(h).not.toContain("old line");
    expect(h.trimEnd().endsWith("- [ ] T01 Booking API: a real phone receives the reschedule SMS")).toBe(true);
  });

  it("drops a task's check once the task is not built, and --check no longer asks for it", () => {
    delivered();
    cli(["deliver", "--change", ID]);
    filled();
    write(root, `.aidw/changes/${ID}/delivery/screenshots/01-book.png`, "png");
    setTasks((ts) => ts.forEach((t) => (t.status = "not_built")));
    cli(["deliver", "--change", ID]);
    const h = handoff();
    expect(h).not.toContain("a real phone receives the reschedule SMS");
    const check = cli(["deliver", "--check", "--change", ID]);
    expect(check.out + check.err).not.toMatch(/Checks for you/);
  });

  it("keeps a check the person ticked when deliver runs again", () => {
    delivered();
    cli(["deliver", "--change", ID]);
    const ticked = handoff().replace("- [ ] T01", "- [x] T01");
    write(root, `.aidw/changes/${ID}/delivery/handoff.md`, ticked);
    cli(["deliver", "--change", ID]);
    expect(handoff()).toContain("- [x] T01 Booking API: a real phone receives the reschedule SMS");
  });

  it("writes no section and no README count when no task has a manual check", () => {
    delivered(TASKS_YAML);
    cli(["deliver", "--change", ID]);
    expect(handoff()).not.toContain(CHECKS_FOR_YOU);
    expect(readFileSync(join(changeDir(), "delivery/README.md"), "utf8")).not.toMatch(/checks for you/i);
  });
});
