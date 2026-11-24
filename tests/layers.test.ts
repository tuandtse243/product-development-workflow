/**
 * S7 (D-28): review layers in quality.yaml, the layer-review verdict, and the read-only layer reviewers.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { agentRole, decide, type HookInput } from "../src/gate.js";
import { AIDW_STATE_COMMAND } from "../src/policy.js";
import { parseQuality } from "../src/quality.js";
import { ANALYSIS_MD, MAIN_SPEC, REQ, TOKENS_YAML, tempProject, write } from "./fixtures.js";

const ID = "2026-11-10-booking";
const SCENARIO = "booking/reschedule-appointment/reschedule-appointment-works";

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], { AIDW_PLUGIN_ROOT: join(root, "plugin") }, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}

const Q = (extra = "") => `layers:
  - name: code
    run: ["node check.js code-ok"]
  - name: ui-ux
    run: ["node shots.js"]
    artifacts: ["test-results/shots/**/*.png"]
    review: ui
  - name: security
    run: ["node check.js audit-ok"]
    review: security
  - name: e2e
    run: ["node check.js e2e-ok"]
deploy:
  target: none
${extra}`;

const TASKS = `tasks:
  - id: T01
    title: Booking page
    role: frontend-engineer
    type: feat
    scenarios: [${SCENARIO}]
    touches: ["app/**", "tests/**"]
    verify: ['node -e "process.exit(0)"']
    status: pending
`;

function project(quality = Q()): string {
  const root = tempProject();
  cli(root, "init");
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  cli(root, "change", "new", ID, "--title", "Booking");
  const c = `.aidw/changes/${ID}`;
  write(root, `${c}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, ".aidw/design/direction.md", "# Direction\n\nCalm clinical palette.\n");
  write(root, `${c}/tasks.yaml`, TASKS);
  write(root, `${c}/quality.yaml`, quality);
  write(root, `${c}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  write(root, "check.js", "process.exit(require('fs').existsSync(process.argv[2]) ? 0 : (console.log('missing ' + process.argv[2]), 1));\n");
  write(root, "shots.js", "const fs=require('fs');fs.mkdirSync('test-results/shots',{recursive:true});fs.writeFileSync('test-results/shots/home-mobile-light.png','');fs.writeFileSync('test-results/shots/home-desktop-dark.png','');console.log('2 shots');\n");
  write(root, "plugin/library/vendor/addy/frontend-ui-engineering/SKILL.md", "# ui\n");
  write(root, "plugin/library/vendor/addy/security-and-hardening/SKILL.md", "# sec\n");
  for (const f of ["code-ok", "audit-ok", "e2e-ok"]) write(root, f, "");
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).err).toBe("");
  expect(cli(root, "approve", ID).code).toBe(0);
  expect(cli(root, "transition", ID, "executing").code).toBe(0);
  // implement T01 with a UI screenshot, as the implementer would
  expect(cli(root, "task", "start", "T01").code).toBe(0);
  write(root, "tests/booking.test.ts", `test("${SCENARIO}: works", () => {})\n`);
  write(root, "app/globals.css", ":root { --accent: #E5533D; --surface: #FAF5EC; font-family: Inter, sans-serif; } .dark { --accent: #FF7A66; }\n");
  write(root, `.aidw/run/shots/${ID}/T01/booking.png`, "");
  expect(cli(root, "checkpoint", "T01").out).toMatch(/^PASS/);
  expect(cli(root, "review", "T01", "pass", "--notes", "VERDICT: pass\nNon-blocking:\n- tidy the header").code).toBe(0);
  expect(cli(root, "transition", ID, "verifying").code).toBe(0);
  return root;
}

const tasks = (root: string) => (YAML.parse(readFileSync(join(root, ".aidw/changes", ID, "tasks.yaml"), "utf8")) as { tasks: Record<string, unknown>[] }).tasks;
const state = (root: string) => cli(root, "status", "--json").json().changes[0].state;
const notes = (root: string, text: string) => {
  const f = join(root, ".aidw/run/notes.md");
  writeFileSync(f, text);
  return f;
};

describe("quality.yaml review layers", () => {
  const diags = (text: string) => parseQuality(text, "q").diags;

  it("accepts review layers with or without commands, and rejects unknown kinds", () => {
    const { config, diags: d } = parseQuality(Q(), "q");
    expect(d.errors).toEqual([]);
    expect(config?.layers.map((l) => [l.name, l.review, l.artifacts])).toEqual([
      ["code", null, []],
      ["ui-ux", "ui", ["test-results/shots/**/*.png"]],
      ["security", "security", []],
      ["e2e", null, []],
    ]);
    expect(parseQuality("layers:\n  - name: code\n    run: [x]\n  - name: sec\n    review: security\n", "q").config?.layers[1]).toMatchObject({ run: [], review: "security" });
    expect(diags("layers:\n  - name: code\n    run: [x]\n  - name: perf\n    review: lighthouse\n").errors.map((e) => e.message)).toEqual([
      'layer "perf": "review" must be one of ui, security, performance (a reviewing Role exists for each)',
    ]);
    expect(diags("layers:\n  - name: code\n    run: [x]\n  - name: perf\n    artifacts: [x]\n").errors.map((e) => e.message)).toEqual([
      'layer "perf" needs a non-empty "run" list of commands (or "review: ui|security|performance")',
    ]);
    expect(diags("layers:\n  - name: code\n    run: [x]\n    artifacts: [\"/abs/*.png\"]\n").errors.map((e) => e.message)).toEqual([
      'layer "code": "artifacts" must be a list of project-relative file globs',
    ]);
  });
});

describe("verify with review layers (S7)", () => {
  it("runs every layer, offers the review layers together with a brief each, records the verdicts, and finishes on pass", () => {
    const root = project();
    const v1 = cli(root, "verify", "--json");
    expect(v1.code).toBe(1);
    const r1 = v1.json();
    expect(r1.layers.map((l: { status: string }) => l.status)).toEqual(["pass", "review", "review", "pass"]);
    expect(r1.awaitingReview).toMatchObject({ layer: "ui-ux", kind: "ui", agent: "aidw:ui-ux-designer", artifacts: ["test-results/shots/home-desktop-dark.png", "test-results/shots/home-mobile-light.png"] });
    expect(r1.awaitingReviews.map((a: { layer: string }) => a.layer)).toEqual(["ui-ux", "security"]);
    const out = cli(root, "verify").out;
    expect(out).toMatch(/^REVIEW: 2 review layers await their reviewers, run them in parallel: "ui-ux" \(ui\), "security" \(security\)/);
    expect(out).toMatch(/layer {2}ui-ux\n {2}agent {2}aidw:ui-ux-designer\n {2}brief {2}\.aidw\/run\/briefs\/.*ui-ux\.layer-review\.md\n {2}prompt Layer review brief: /);
    expect(out).toMatch(/layer {2}security\n {2}agent {2}aidw:security\n/);
    expect(out).toMatch(/NEXT: spawn these 2 reviewers in one message, one subagent each with its prompt; when each returns, run `aidw layer-review <layer> --change 2026-11-10-booking` for it, then `aidw verify` again/);

    const brief = readFileSync(join(root, r1.awaitingReview.brief), "utf8");
    expect(brief).toMatch(/^# Layer review brief: ui-ux \(ui review\) - Booking/);
    expect(brief).toContain(join(root, "test-results/shots/home-mobile-light.png"));
    expect(brief).not.toContain(`.aidw/run/shots/${ID}/T01/booking.png`); // per-task shots were reviewed per task
    expect(brief).toMatch(/UI tasks in this change: T01 \(Booking page\)/);
    expect(brief).toMatch(/\| `accent` \| color \|/); // tokens table
    expect(brief).toMatch(/- D1: Times are stored in UTC/);
    expect(brief).toMatch(/`node shots.js` \(exit 0, \d+s\):\n\n```\n2 shots\n```/);
    expect(brief).toContain(join(root, "plugin/library/vendor/addy/frontend-ui-engineering/SKILL.md"));
    expect(brief).toMatch(/\.aidw\/design`: design direction/);
    expect(brief).toMatch(/## Checklist\n\n1\. \*\*Design compliance/);

    // a second verify does not rerun the commands: the layers still wait
    const again = cli(root, "verify", "--json").json();
    expect(again.layers[1]).toMatchObject({ name: "ui-ux", status: "review" });
    expect(again.layers[2]).toMatchObject({ name: "security", status: "review" });
    expect(cli(root, "transition", ID, "converging").err).toMatch(/pending: ui-ux, security/);

    // a layer not awaiting review or a non-review layer cannot take a verdict
    expect(cli(root, "layer-review", "e2e", "pass").err).toMatch(/layer "e2e" has no "review:" kind/);
    expect(cli(root, "layer-review", "code", "pass").err).toMatch(/layer "code" has no "review:" kind/);
    expect(cli(root, "layer-review", "ui-ux", "fix").err).toMatch(/a fix verdict needs --notes or --notes-file/);

    const pass1 = cli(root, "layer-review", "ui-ux", "pass", "--notes-file", notes(root, "VERDICT: pass\nNon-blocking:\n- the day cells differ in height"));
    expect(pass1.out).toMatch(/^ui-ux: ui review pass -> layer "ui-ux" passed its ui review; layers still to run: security/);
    const sum = JSON.parse(readFileSync(join(root, ".aidw/changes", ID, "evidence/quality/summary.json"), "utf8"));
    expect(sum.layers["ui-ux"]).toMatchObject({ status: "pass", review: { verdict: "pass", notes: "VERDICT: pass\nNon-blocking:\n- the day cells differ in height" } });

    const v2 = cli(root, "verify", "--json").json();
    expect(v2.awaitingReview).toMatchObject({ layer: "security", kind: "security", agent: "aidw:security", artifacts: [] });
    expect(v2.layers.map((l: { status: string }) => l.status)).toEqual(["skipped", "skipped", "review", "skipped"]);
    const sec = readFileSync(join(root, v2.awaitingReview.brief), "utf8");
    expect(sec).toMatch(/security reviewer/);
    expect(sec).toMatch(/Code: the whole project \(no base commit was recorded\)/);
    expect(sec).toMatch(/1\. \*\*Authorization\./);
    expect(sec).not.toMatch(/Design tokens/);
    expect(cli(root, "layer-review", "security", "pass").out).toMatch(/note: no reviewer reply recorded/);

    const v3 = cli(root, "verify", "--json").json();
    expect(v3).toMatchObject({ ok: true, summary: "all quality layers pass" });
    expect(v3.layers.map((l: { status: string }) => l.status)).toEqual(["skipped", "skipped", "skipped", "skipped"]);
    expect(cli(root, "transition", ID, "converging").code).toBe(0);

    // the quality report shows the layer verdicts and both kinds of non-blocking remarks
    cli(root, "converge");
    cli(root, "transition", ID, "deploying");
    cli(root, "deploy");
    cli(root, "transition", ID, "delivered");
    expect(cli(root, "deliver").out).toMatch(/wrote \d+ file\(s\), created handoff\.md skeleton/); // INCOMPLETE until the handoff is filled in
    const report = readFileSync(join(root, ".aidw/changes", ID, "delivery/quality-report.md"), "utf8");
    expect(report).toMatch(/\| ui-ux \| pass \| .* \| ui reviewer: pass \(/);
    expect(report).toMatch(/\| security \| pass \|.*\| security reviewer: pass/);
    expect(report).toMatch(/- T01: - tidy the header/);
    expect(report).toMatch(/- layer ui-ux: - the day cells differ in height/);
    expect(report).toMatch(/layer "a11y" was not in the approved quality profile: nothing here covers it/);
    expect(report).not.toMatch(/layer "ui-ux" was not/);
  });

  it("turns a fix verdict into a fix task with the notes, and escalates past max_fix_rounds", () => {
    const root = project(Q("max_fix_rounds: 1\n"));
    cli(root, "verify");
    const fix = cli(root, "layer-review", "ui-ux", "fix", "--notes-file", notes(root, "VERDICT: fix\n1. home, mobile: the icon grid overflows by 8px -> use a 6-column grid"), "--json").json();
    expect(fix).toMatchObject({ ok: true, verdict: "fix", fixTask: "Q01" });
    expect(state(root)).toBe("executing");
    const q = tasks(root).find((t) => t.id === "Q01");
    expect(q).toMatchObject({ origin: "quality", layer: "ui-ux", verify: ["node shots.js"] });
    expect(String(q?.problem)).toMatch(/Quality layer "ui-ux" \(ui review\) asked for fixes[\s\S]*icon grid overflows by 8px/);
    expect(cli(root, "approval", "check", ID).code).toBe(0);

    cli(root, "task", "start", "Q01");
    expect(readFileSync(cli(root, "brief", "Q01").out.trim(), "utf8")).toMatch(/## Problem to fix[\s\S]*icon grid overflows/);
    write(root, `.aidw/run/shots/${ID}/Q01/fixed.png`, "");
    expect(cli(root, "checkpoint", "Q01").out).toMatch(/^PASS/);
    cli(root, "review", "Q01", "pass");
    cli(root, "transition", ID, "verifying");

    // the whole chain reruns on the new code, the reviewer still says fix: rounds exhausted
    expect(cli(root, "verify", "--json").json().awaitingReview).toMatchObject({ layer: "ui-ux" });
    const again = cli(root, "layer-review", "ui-ux", "fix", "--notes", "VERDICT: fix\n1. still overflows", "--json");
    expect(again.code).toBe(1);
    expect(again.json()).toMatchObject({ escalated: true });
    expect(state(root)).toBe("escalated");
  });

  it("reports missing artifacts to the reviewer instead of failing silently", () => {
    const root = project(Q().replace('run: ["node shots.js"]', 'run: ["node check.js code-ok"]'));
    const r = cli(root, "verify", "--json").json();
    expect(r.awaitingReview.artifacts).toEqual([]);
    expect(readFileSync(join(root, r.awaitingReview.brief), "utf8")).toMatch(/No file matched the layer's artifact globs \(`test-results\/shots\/\*\*\/\*\.png`\)/);
  });
});

describe("review layers in parallel (D13)", () => {
  const A11Y = `  - name: a11y
    run: ["node check.js e2e-ok"]
    review: ui
`;
  const withA11y = (extra = "") => Q(extra).replace("deploy:\n", `${A11Y}deploy:\n`);

  it("offers at most one browser-driving reviewer at a time; the next one is offered after it", () => {
    const root = project(withA11y());
    const r = cli(root, "verify", "--json").json();
    expect(r.layers.map((l: { status: string }) => l.status)).toEqual(["pass", "review", "review", "pass", "review"]);
    expect(r.awaitingReviews.map((a: { layer: string; browser: boolean }) => [a.layer, a.browser])).toEqual([["ui-ux", true], ["security", false]]);
    expect(r.waitingReviews).toEqual(["a11y"]);
    expect(cli(root, "verify").out).toMatch(/a11y waits for the next round/);
    cli(root, "layer-review", "ui-ux", "pass");
    const next = cli(root, "verify", "--json").json();
    expect(next.awaitingReviews.map((a: { layer: string }) => a.layer)).toEqual(["security", "a11y"]);
  });

  it("honours parallel.max", () => {
    const root = project(Q("parallel:\n  max: 1\n"));
    const r = cli(root, "verify", "--json").json();
    expect(r.awaitingReviews.map((a: { layer: string }) => a.layer)).toEqual(["ui-ux"]);
    expect(r.waitingReviews).toEqual(["security"]);
    expect(cli(root, "verify").out).toMatch(/^REVIEW: layer "ui-ux" awaits its ui review/);
  });

  it("records every verdict of a group, also after one of them added a fix task", () => {
    const root = project();
    cli(root, "verify");
    const fix = cli(root, "layer-review", "ui-ux", "fix", "--notes", "VERDICT: fix\n1. overflow", "--json").json();
    expect(fix).toMatchObject({ verdict: "fix", fixTask: "Q01" });
    expect(state(root)).toBe("executing");
    const sec = cli(root, "layer-review", "security", "fix", "--notes", "VERDICT: fix\n1. no rate limit", "--json");
    expect(sec.code).toBe(0);
    expect(sec.json()).toMatchObject({ verdict: "fix", fixTask: "Q02" });
    expect(state(root)).toBe("executing");
    expect(tasks(root).filter((t) => t.origin === "quality").map((t) => [t.id, t.layer])).toEqual([["Q01", "ui-ux"], ["Q02", "security"]]);
    // once a verdict is recorded the layer takes no second one
    expect(cli(root, "layer-review", "security", "pass").err).toMatch(/runs in state verifying/);
  });
});

describe("layer reviewers are read-only subagents", () => {
  const hook = (cwd: string, tool_name: string, tool_input: Record<string, unknown>, agent_type: string): HookInput => ({ hook_event_name: "PreToolUse", tool_name, tool_input, cwd, agent_type });

  it("treats the read-only Roles (ui-ux-designer, security) like the task reviewer", () => {
    expect(["aidw:ui-ux-designer", "security", "aidw:code-reviewer"].map((a) => agentRole(a))).toEqual(["reviewer", "reviewer", "reviewer"]);
    expect(agentRole("aidw:fullstack")).toBe("implementer");
    // an environment override must not turn a reviewer into a writer
    expect(agentRole("aidw:code-reviewer", { AIDW_PLUGIN_ROOT: "/nowhere" } as NodeJS.ProcessEnv)).toBe("reviewer");
    expect(agentRole("general-purpose")).toBeNull();
    const root = project();
    const d = (h: HookInput) => decide(h, {})?.decision ?? "none";
    expect(d(hook(root, "Write", { file_path: join(root, "app/page.tsx") }, "aidw:ui-ux-designer"))).toBe("deny");
    expect(d(hook(root, "Bash", { command: "echo x > app/page.tsx" }, "aidw:security"))).toBe("deny");
    expect(d(hook(root, "Bash", { command: "aidw layer-review ui-ux pass" }, "aidw:ui-ux-designer"))).toBe("deny");
    expect(d(hook(root, "Bash", { command: "aidw verify" }, "aidw:security"))).toBe("deny");
    expect(d(hook(root, "Bash", { command: "git diff abc123 --stat" }, "aidw:security"))).toBe("none");
    expect(d(hook(root, "Bash", { command: "npx playwright test --project=shots" }, "aidw:ui-ux-designer"))).toBe("none");
  });

  it("keeps verify, deploy and layer-review out of every subagent's hands", () => {
    for (const c of ["aidw layer-review ui-ux pass", "aidw verify --change x", "aidw deploy", "aidw converge", "aidw deliver --check"]) expect([c, AIDW_STATE_COMMAND.test(c)]).toEqual([c, true]);
    expect(AIDW_STATE_COMMAND.test("aidw status")).toBe(false);
  });
});
