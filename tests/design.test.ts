import { execFileSync } from "node:child_process";
import { readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { colorLiterals, hardcodedColors, missingTokens, normalizeColor, parseTokens } from "../src/design.js";
import { Diags } from "../src/diag.js";
import { staleReadmeCommands } from "../src/deliver.js";
import { decide } from "../src/gate.js";
import { commitAidw } from "../src/ops.js";
import { runStopFailure } from "../src/pause.js";
import { pathsFor } from "../src/project.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TOKENS_YAML, tempProject, write } from "./fixtures.js";

const ID = "2026-11-09-shop";
const SCENARIO = "booking/reschedule-appointment/reschedule-appointment-works";
const OK = `node -e "process.exit(0)"`;
const TASKS = `tasks:
  - id: T01
    title: Booking page
    role: frontend-engineer
    type: feat
    specs: [booking/reschedule-appointment]
    scenarios: [${SCENARIO}]
    touches: ["app/(site)/book/**", "app/globals.css", "tests/**"]
    verify: ['${OK}']
    status: pending
`;
const SCENARIO_TEST = `import { test } from "vitest";\ntest("${SCENARIO}: moves it", () => {});\n`;
const CSS = ":root { --accent: #E5533D; --surface: rgb(250, 245, 236); font-family: Inter, sans-serif; }\n.dark { --accent: #ff7a66; }\n";

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}

function packageFor(root: string, opts: { tokens?: boolean; analysis?: string } = {}) {
  cli(root, "init");
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  cli(root, "change", "new", ID);
  const c = `.aidw/changes/${ID}`;
  write(root, `${c}/analysis.md`, opts.analysis ?? ANALYSIS_MD);
  if (opts.tokens !== false) write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `${c}/tasks.yaml`, TASKS);
  write(root, `${c}/quality.yaml`, QUALITY_YAML);
  write(root, `${c}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
}

function executing(): string {
  const root = tempProject();
  packageFor(root);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).code).toBe(0);
  expect(cli(root, "approve", ID).code).toBe(0);
  const g = (...a: string[]) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
  g("init", "-q");
  g("config", "user.email", "aidw@test");
  g("config", "user.name", "aidw test");
  g("add", "-A");
  g("commit", "-q", "-m", "baseline");
  expect(cli(root, "transition", ID, "executing").code).toBe(0);
  return root;
}

const shot = (root: string, name = "page.png") => write(root, `.aidw/run/shots/${ID}/T01/${name}`, "png");
const t01 = (root: string) =>
  (YAML.parse(readFileSync(join(root, ".aidw/changes", ID, "tasks.yaml"), "utf8")) as { tasks: Record<string, unknown>[] }).tasks[0];

describe("design tokens that reuse the existing design", () => {
  it("need at least one token, not an invented color: no color token is a warning", () => {
    const d = new Diags();
    const tokens = parseTokens("tokens:\n  - name: body\n    kind: font\n    value: system-ui\n    use: all text on the home page, including the counter\n", "t.yaml", d);
    expect(tokens).toHaveLength(1);
    expect(d.errors).toEqual([]);
    expect(d.warnings.map((w) => w.message).join()).toMatch(/no color token: reviewers cannot check color use/);
  });

  it("still refuses an empty token file", () => {
    const d = new Diags();
    parseTokens("tokens: []\n", "t.yaml", d);
    expect(d.errors.map((e) => e.message).join()).toMatch(/non-empty/);
  });
});

describe("design tokens", () => {
  it("parses tokens and rejects what the reviewer could not check", () => {
    const d = new Diags();
    expect(parseTokens(TOKENS_YAML, "tokens.yaml", d).map((t) => t.name)).toEqual(["accent", "surface", "body"]);
    expect(d.errors).toEqual([]);

    const bad = new Diags();
    parseTokens(
      `tokens:\n  - { name: Accent, kind: color, value: "#fff", use: buttons and links }\n  - { name: x, kind: paint, value: red, use: everywhere ok }\n  - { name: y, kind: color, value: tomato, use: headings only }\n  - { name: z, kind: font, value: Inter, use: "" }\n`,
      "tokens.yaml",
      bad,
    );
    const msgs = bad.errors.map((e) => e.message).join("\n");
    expect(msgs).toMatch(/kebab-case/);
    expect(msgs).toMatch(/kind must be one of/);
    expect(msgs).toMatch(/"tomato" is not a color literal/);
    expect(msgs).toMatch(/`use` must say where/);
  });

  it("compares color literals in canonical form", () => {
    expect(normalizeColor("#FFF")).toBe("#ffffff");
    expect(normalizeColor("rgb(229, 83, 61)")).toBe("#e5533d");
    expect(normalizeColor("rgb(229 83 61 / 50%)")).toBe("#e5533d80");
    expect(normalizeColor("#e5533dff")).toBe("#e5533d");
    expect(normalizeColor("oklch(0.7  0.1 30)")).toBe("oklch(0.7 0.1 30)");
    expect(colorLiterals("a{color:#E5533D;background:rgb(250,245,236)}")).toEqual(["#e5533d", "#faf5ec"]);
  });

  it("finds tokens missing from the code and stray color literals", () => {
    const root = tempProject();
    write(root, "app/globals.css", CSS);
    write(root, "app/page.tsx", 'export default () => <p style={{ color: "#123456" }}>hi</p>;\n');
    write(root, "tests/x.test.ts", 'const c = "#abcdef";\n');
    const d = new Diags();
    const tokens = parseTokens(TOKENS_YAML, "t", d);
    expect(missingTokens(root, tokens)).toEqual([]);
    write(root, "app/globals.css", ":root { --surface: #faf5ec; }\n");
    expect(missingTokens(root, tokens)).toEqual(["accent #E5533D", "accent (dark) #FF7A66", "body Inter, sans-serif"]);
    expect(hardcodedColors(root, ["app/page.tsx", "app/globals.css", "tests/x.test.ts"], tokens)).toEqual(["app/page.tsx: #123456"]);
  });
});

describe("analyze: decisions and tokens", () => {
  it("requires tokens when tasks change UI, and well-formed decisions", () => {
    const root = tempProject();
    packageFor(root, { tokens: false, analysis: ANALYSIS_MD.replace("- D2: Booking", "- Booking") });
    const r = cli(root, "analyze", ID);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/tokens\.yaml\s+missing: task\(s\) T01 change UI/);
    expect(r.out).toMatch(/must be "- D<n>: <decision>"/);
  });

  it("accepts None, and rejects a missing section", () => {
    const root = tempProject();
    packageFor(root, { analysis: ANALYSIS_MD.replace(/- D1:.*\n- D2:.*\n/, "None\n") });
    expect(cli(root, "analyze", ID).code).toBe(0);
    write(root, `.aidw/changes/${ID}/analysis.md`, ANALYSIS_MD.replace(/## Decisions to honor\n\n- D1:.*\n- D2:.*\n/, ""));
    expect(cli(root, "analyze", ID).out).toMatch(/missing section "## Decisions to honor"/);
  });
});

describe("checkpoint and briefs for UI tasks", () => {
  let root: string;
  beforeEach(() => {
    root = executing();
    write(root, "tests/booking.test.ts", SCENARIO_TEST);
  });

  it("puts decisions, tokens and the screenshot folder in the implement brief", () => {
    cli(root, "task", "start", "T01");
    const brief = readFileSync(cli(root, "brief", "T01").out.trim(), "utf8");
    expect(brief).toMatch(/## Decisions to honor \(approved; binding\)\n\n- D1: Times are stored in UTC/);
    expect(brief).toMatch(/stop and report it as a blocker; never deviate silently/);
    expect(brief).toMatch(/\| `accent` \| color \| `#E5533D` \| `#FF7A66` \| primary buttons and the selected slot \|/);
    expect(brief).toContain(join(root, ".aidw/run/shots", ID, "T01"));
  });

  it("fails without the tokens in the code or without a fresh screenshot", () => {
    cli(root, "task", "start", "T01");
    write(root, "app/globals.css", ":root { --surface: #faf5ec; }\n");
    const fail = cli(root, "checkpoint", "T01", "--json");
    expect(fail.code).toBe(1);
    expect(fail.json().design).toMatchObject({ missing_tokens: ["accent #E5533D", "accent (dark) #FF7A66", "body Inter, sans-serif"], screenshots: [] });
    expect(String(t01(root)?.notes)).toMatch(/design tokens not in the code: accent #E5533D.*no fresh screenshot/);

    // the retry brief names both problems
    cli(root, "task", "start", "T01");
    const brief = readFileSync(cli(root, "brief", "T01").out.trim(), "utf8");
    expect(brief).toMatch(/Design tokens not found in the code: `accent #E5533D`/);
    expect(brief).toMatch(/No fresh screenshot in/);

    // a screenshot from before the failed checkpoint does not count
    const old = shot(root, "old.png");
    utimesSync(old, new Date(Date.now() - 3600_000), new Date(Date.now() - 3600_000));
    write(root, "app/globals.css", CSS);
    const stale = cli(root, "checkpoint", "T01");
    expect(stale.code).toBe(1);
    // the text output says why, even when every verify command passed
    expect(stale.out).toMatch(/design: 0 fresh screenshot\(s\)/);
    expect(stale.out).toMatch(/PROBLEM no fresh screenshot in \.aidw\/run\/shots\//);
    expect(readFileSync(cli(root, "brief", "T01").out.trim(), "utf8")).toMatch(/Every attempt, retries included, saves new ones/);

    cli(root, "task", "start", "T01");
    write(root, "app/(site)/book/page.tsx", 'export default () => <b style={{ color: "#00ff00" }} />;\n');
    shot(root);
    const pass = cli(root, "checkpoint", "T01", "--json");
    expect(pass.code).toBe(0);
    expect(pass.json().design).toMatchObject({ missing_tokens: [], screenshots: [`.aidw/run/shots/${ID}/T01/page.png`] });
    expect(pass.json().design.hardcoded_colors).toEqual(["app/(site)/book/page.tsx: #00ff00"]);

    const review = readFileSync(cli(root, "brief", "T01", "--for", "review").out.trim(), "utf8");
    expect(review).toContain(`Screenshots (open each with Read): \`${join(root, ".aidw/run/shots", ID, "T01/page.png")}\``);
    expect(review).toMatch(/Color literals that are not tokens.*#00ff00/);
    expect(review).toMatch(/4\. Every \*\*Decision to honor\*\*/);
    expect(review).toMatch(/5\. Design: look at every screenshot/);
  });

  it("lets the implementer write screenshots, and nothing else, under .aidw/", () => {
    const h = (file_path: string) =>
      decide({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path, content: "x" }, cwd: root, agent_type: "aidw:fullstack" }, {})?.decision;
    expect(h(join(root, ".aidw/run/shots", ID, "T01/a.png"))).toBe("allow");
    expect(h(join(root, ".aidw/changes", ID, "tasks.yaml"))).toBe("deny");
  });
});

describe("StopFailure input (OPEN-12)", () => {
  it("pauses with the error and its details", () => {
    const root = executing();
    const paused = runStopFailure(JSON.stringify({ cwd: root, hook_event_name: "StopFailure", error: "rate_limit", error_details: "429 Too Many Requests" }), {});
    expect(paused).toEqual([ID]);
    const change = YAML.parse(readFileSync(join(root, ".aidw/changes", ID, "change.yaml"), "utf8"));
    expect(change.run.paused).toMatchObject({ from: "executing", reason: "rate_limit: 429 Too Many Requests" });
  });
});

describe("delivery: README commands", () => {
  it("reports README commands that call scripts package.json does not define", () => {
    const root = tempProject();
    write(root, "package.json", JSON.stringify({ scripts: { dev: "next dev", build: "next build", test: "vitest run", "test:e2e": "playwright test" } }));
    write(
      root,
      "README.md",
      "```bash\npnpm install\nnpm ci\npnpm dev\nnpm run build\npnpm test\nnpm run test:e2e\npnpm e2e\nnpm run lint\nnpm start\nnpx playwright install chromium\n```\n",
    );
    expect(staleReadmeCommands(root)).toEqual(["pnpm e2e", "npm run lint", "npm start"]);
  });
});

describe("archive commit", () => {
  it("includes README.md and .env.example with .aidw/, nothing else", () => {
    const root = executing();
    write(root, "README.md", "# Shop\n\n`pnpm dev`\n");
    write(root, ".env.example", "API_URL=\n");
    write(root, "src/stray.ts", "x\n");
    write(root, ".aidw/run/../decisions/0009-x.md", "# X\n");
    expect(commitAidw(pathsFor(root), "aidw: archive", { delivery: true })).toMatch(/^[0-9a-f]{40}$/);
    const files = execFileSync("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: root, encoding: "utf8" }).trim().split("\n").sort();
    expect(files).toEqual(expect.arrayContaining([".aidw/decisions/0009-x.md", ".env.example", "README.md"]));
    expect(files.filter((f) => !f.startsWith(".aidw/") && f !== "README.md" && f !== ".env.example")).toEqual([]);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" })).toMatch(/\?\? src\//);
  });
});
