/**
 * D4 (ADR-0011): before the Approval Gate, after the CLI's own checks, one read-only code-reviewer Agent grades the
 * architecture and the plan against a fixed list. At most 2 fix rounds; what is still open goes to the top of the gate
 * Decision Page.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { decide, type HookInput } from "../src/gate.js";
import { AIDW_STATE_COMMAND } from "../src/policy.js";
import { CHECKLIST, MAX_FIX_ROUNDS, parsePlanReview } from "../src/planreview.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, tempProject, write } from "./fixtures.js";

const ID = "2026-11-24-booking";
const plugin = join(__dirname, "..", "plugins", "aidw");
const SCENARIO = "booking/reschedule-appointment/reschedule-appointment-works";
const verdictPath = (root: string) => join(root, ".aidw/run", `review-plan-${ID}.md`);

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}

/** A product change in analyzing with the whole package in place: `aidw analyze` is clean. */
function drafted(): string {
  const root = tempProject();
  cli(root, "init");
  expect(cli(root, "change", "new", ID, "--workflow", "product").code).toBe(0);
  const c = `.aidw/changes/${ID}`;
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  write(root, `${c}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `${c}/tasks.yaml`, TASKS_YAML);
  write(root, `${c}/quality.yaml`, QUALITY_YAML);
  write(root, `${c}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  for (const s of ["intake", "analyzing"]) expect(cli(root, "transition", ID, s).code, s).toBe(0);
  return root;
}

/** The lead has reported every stage before the review. */
const STAGES = ["discovery", "research", "user-research", "requirements", "design", "architecture", "contracts", "plan", "quality-profile"];
function stepped(): string {
  const root = drafted();
  for (const s of STAGES) expect(cli(root, "stages", "--done", s, "--change", ID).code, s).toBe(0);
  return root;
}

const FIX = (n: number) => `VERDICT: fix

## Findings

1. [item 4] T02: round ${n}: the booking page adds a client-side slot cache the architecture does not need -> read slots from Supabase as D2 says
2. [item 1] ${SCENARIO}: T01 names it but only tests the helper -> drive the route

Non-blocking:
- 3. [item 9] not parsed: remarks are free text
`;
const PASS = "VERDICT: pass\n\nNon-blocking:\n- the plan could name the timezone helper\n";

/** The reviewer writes its verdict; the CLI records it. */
function review(root: string, text: string) {
  write(root, `.aidw/run/review-plan-${ID}.md`, text);
  return cli(root, "plan-review", ID);
}
const rounds = (root: string) => (YAML.parse(readFileSync(join(root, ".aidw/changes", ID, "plan-review.yaml"), "utf8")) as { rounds: { round: number; verdict: string }[] }).rounds;

describe("parsePlanReview: the verdict file", () => {
  it("reads the verdict and every numbered finding with its checklist item and what it names", () => {
    const r = parsePlanReview(FIX(1));
    expect(r.problems).toEqual([]);
    expect(r.verdict).toBe("fix");
    expect(r.findings).toEqual([
      { item: 4, target: "T02", text: "round 1: the booking page adds a client-side slot cache the architecture does not need -> read slots from Supabase as D2 says" },
      { item: 1, target: SCENARIO, text: "T01 names it but only tests the helper -> drive the route" },
    ]);
    expect(parsePlanReview(PASS)).toEqual({ verdict: "pass", findings: [], problems: [] });
  });

  it("refuses a verdict in the wrong shape", () => {
    const problems = (t: string) => parsePlanReview(t).problems.join("\n");
    expect(problems("Looks fine to me.\n")).toMatch(/first line must be `VERDICT: pass` or `VERDICT: fix`/);
    expect(problems("VERDICT: fix\n\nNon-blocking:\n- small things\n")).toMatch(/a `fix` verdict lists at least one finding/);
    expect(problems("VERDICT: pass\n1. [item 2] T01: extra export button -> drop it\n")).toMatch(/a `pass` verdict lists no findings/);
    expect(problems("VERDICT: fix\n1. [item 5] T01: x -> y\n")).toMatch(/item 5 is not on the list \(1 to 4\)/);
    expect(problems("VERDICT: fix\n1. T01 is too big\n")).toMatch(/line 2: a finding reads "N\. \[item 1-4\] <task id \| scenario id \| area>: <problem> -> <expected fix>"/);
  });

  it("keeps the fixed list of four items", () => {
    expect(CHECKLIST).toHaveLength(4);
    expect(CHECKLIST[0]).toMatch(/scenario/);
    expect(CHECKLIST[1]).toMatch(/scope/);
    expect(CHECKLIST[2]).toMatch(/constitution/);
    expect(CHECKLIST[3]).toMatch(/complexity/);
    expect(MAX_FIX_ROUNDS).toBe(2);
  });
});

describe("the Approval Gate waits for the plan review", () => {
  it("refuses awaiting_approval without a review verdict, and offers the review stage after the quality profile", () => {
    const root = drafted();
    const r = cli(root, "transition", ID, "awaiting_approval");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/"awaiting_approval" needs the independent review of architecture and plan \(stage plan-review\)/);
    expect(r.err).toContain(`aidw plan-review ${ID} --brief`);
    for (const s of STAGES) expect(cli(root, "stages", "--done", s, "--change", ID).code, s).toBe(0);
    const next = cli(root, "stages", ID).out;
    expect(next).toMatch(/NEXT: stage plan-review \(.*\): run `aidw plan-review 2026-11-24-booking --brief`, spawn aidw:code-reviewer with the brief, then record its verdict with `aidw plan-review 2026-11-24-booking`/);
    // the stage is done when its verdict is recorded, not by reporting it
    expect(cli(root, "stages", "--done", "plan-review", "--change", ID).err).toMatch(/stage "plan-review" is done when its verdict is recorded/);
  });

  it("writes a read-only brief with the fixed list, the inputs and where the verdict goes", () => {
    const root = drafted();
    const r = cli(root, "plan-review", ID, "--brief");
    expect(r.code, r.err).toBe(0);
    const [path] = r.out.split("\n");
    expect(r.out).toMatch(/SPAWN aidw:code-reviewer with: Plan review brief: .*plan-review\.md\. Read it and write your verdict as it says\./);
    const text = readFileSync(path as string, "utf8");
    expect(text).toMatch(/independent reviewer in a fresh context/);
    expect(text).toMatch(/Round 1 of at most 3/);
    for (const item of CHECKLIST) expect(text).toContain(item);
    expect(text).toContain(join(plugin, "roles", "code-reviewer", "skills", "plan-review.md"));
    expect(text).toContain(`.aidw/changes/${ID}/tasks.yaml`);
    expect(text).toContain(".aidw/constitution.md");
    expect(text).toContain(SCENARIO);
    expect(text).toContain(verdictPath(root));
    expect(text).toMatch(/\[item 1-4\] <task id \| scenario id \| area>/);
  });

  it("writes the brief only after the CLI's own checks pass", () => {
    const root = drafted();
    write(root, `.aidw/changes/${ID}/analysis.md`, ANALYSIS_MD.replace("## Plan\n\n2 tasks, 2 waves.\n", ""));
    const r = cli(root, "plan-review", ID, "--brief");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/the CLI's own checks come first: fix what `aidw analyze` reports/);
  });

  it("a pass verdict records round 1, marks the stage done and opens the gate", () => {
    const root = stepped();
    const r = review(root, PASS);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/plan review round 1: pass/);
    expect(r.out).toMatch(/NEXT: `aidw transition 2026-11-24-booking awaiting_approval`/);
    expect(rounds(root)).toMatchObject([{ round: 1, verdict: "pass" }]);
    expect(cli(root, "stages", ID).out).toMatch(/done +plan-review/);
    expect(cli(root, "transition", ID, "awaiting_approval").code).toBe(0);
  });

  it("refuses a verdict whose findings name no task, scenario or area of this change; the round is not counted", () => {
    const root = drafted();
    const r = review(root, "VERDICT: fix\n1. [item 2] T09: an export task -> drop it\n");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/finding 1 names "T09", which is not a task, a requirement or scenario of this change, or an area/);
    expect(existsSync(join(root, ".aidw/changes", ID, "plan-review.yaml"))).toBe(false);
  });

  it("a fix verdict allows at most 2 fix rounds, then the Change proceeds with the findings carried to the top of the gate page", () => {
    const root = stepped();
    const first = review(root, FIX(1));
    expect(first.code, first.err).toBe(0);
    expect(first.out).toMatch(/plan review round 1: fix \(2 finding\(s\)\); fix round 1 of 2/);
    expect(first.out).toMatch(/\[item 4\] T02: .* -> technical-planner/);
    expect(first.out).toMatch(/NEXT: give each finding to the Role named after it/);
    const refused = cli(root, "transition", ID, "awaiting_approval");
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/fix round 1 of 2 is open/);
    // the same verdict again is not a new round
    expect(cli(root, "plan-review", ID).err).toMatch(/this verdict was already recorded as round 1/);
    // an edited verdict that was not recorded keeps the gate closed
    expect(review(root, FIX(2)).out).toMatch(/fix round 2 of 2/);
    write(root, `.aidw/run/review-plan-${ID}.md`, PASS);
    expect(cli(root, "transition", ID, "awaiting_approval").err).toMatch(/the verdict file changed after round 2 was recorded/);
    // the brief of the next round removes the old verdict only once it is recorded
    expect(cli(root, "plan-review", ID, "--brief").err).toMatch(/is not recorded yet: run `aidw plan-review 2026-11-24-booking` first/);
    write(root, `.aidw/run/review-plan-${ID}.md`, FIX(2));
    const brief = cli(root, "plan-review", ID, "--brief");
    expect(brief.code, brief.err).toBe(0);
    const text = readFileSync(brief.out.split("\n")[0] as string, "utf8");
    expect(text).toMatch(/Round 3 of at most 3/);
    expect(text).toMatch(/Findings of round 2 to check again/);
    expect(text).toContain("round 2: the booking page adds a client-side slot cache");
    expect(existsSync(verdictPath(root))).toBe(false);
    // the third review is the last: what is still open is carried
    const last = review(root, FIX(3));
    expect(last.code, last.err).toBe(0);
    expect(last.out).toMatch(/plan review round 3: fix; the 2 fix rounds are used up: 2 finding\(s\) stay open and go to the top of the gate page/);
    expect(rounds(root).map((x) => x.verdict)).toEqual(["fix", "fix", "fix"]);
    expect(cli(root, "stages", ID).out).toMatch(/done +plan-review/);
    expect(cli(root, "plan-review", ID).err).toMatch(/the plan review is finished \(round 3: findings carried to the gate\)/);
    expect(cli(root, "plan-review", ID, "--brief").err).toMatch(/the plan review is finished/);
    const t = cli(root, "transition", ID, "awaiting_approval");
    expect(t.code, t.err).toBe(0);

    write(root, ".aidw/run/pages/gate.yaml", `layout: gate\ntitle: Approve\nchange: ${ID}\nsections:\n  - id: scope\n    title: Scope\n    body: Booking.\n`);
    expect(cli(root, "page", "render", "gate").code).toBe(0);
    const html = readFileSync(join(root, ".aidw/run/pages/gate.html"), "utf8");
    const secs = [...html.matchAll(/data-sec="([^"]+)"/g)].map((m) => m[1]);
    expect(secs[0]).toBe("open-findings");
    expect(secs).toContain("scope");
    expect(html).toMatch(/Open findings of the independent review/);
    expect(html).toContain("round 3: the booking page adds a client-side slot cache");
    expect(html).toMatch(/item 1<\/b> \(every approved scenario/);
  });

  it("shows no findings section on the gate page after a pass", () => {
    const root = drafted();
    review(root, PASS);
    cli(root, "transition", ID, "awaiting_approval");
    write(root, ".aidw/run/pages/gate.yaml", `layout: gate\ntitle: Approve\nchange: ${ID}\nsections:\n  - id: scope\n    title: Scope\n    body: Booking.\n`);
    expect(cli(root, "page", "render", "gate").code).toBe(0);
    expect(readFileSync(join(root, ".aidw/run/pages/gate.html"), "utf8")).not.toMatch(/data-sec="open-findings"/);
  });

  it("lets the read-only reviewer write its verdict file and nothing else; recording it is the lead's", () => {
    const root = drafted();
    const write = (file: string): string =>
      decide({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: file, content: "x" }, cwd: root, agent_type: "aidw:code-reviewer" } as HookInput, {})?.decision ?? "none";
    expect(write(verdictPath(root))).toBe("allow");
    expect(write(join(root, ".aidw/changes", ID, "tasks.yaml"))).toBe("deny");
    expect(AIDW_STATE_COMMAND.test(`aidw plan-review ${ID}`)).toBe(true);
    expect(AIDW_STATE_COMMAND.test(`aidw plan-review ${ID} --brief`)).toBe(true);
  });

  it("refuses the gate when the recorded verdict file is gone", () => {
    const root = drafted();
    expect(review(root, PASS).out).toMatch(/stage plan-review is not marked done \(.*waits for discovery\); the gate needs only the recorded verdict/);
    rmSync(verdictPath(root));
    expect(cli(root, "transition", ID, "awaiting_approval").err).toMatch(/the plan review's verdict file .* is missing/);
  });
});

describe("the plan review is part of the Role and the lead's skill", () => {
  const read = (f: string) => readFileSync(join(plugin, f), "utf8");
  it("code-reviewer lists plan-review with its load condition, and the skill has a right/wrong pair and Sources", () => {
    const role = read("roles/code-reviewer/role.md");
    expect(role).toMatch(/plan-review: when the brief is a pre-gate review of architecture and plan/);
    expect(role).toMatch(/writes: \[.*plan-review.*\]/);
    const skill = read("roles/code-reviewer/skills/plan-review.md");
    expect(skill).toMatch(/## Right and wrong/);
    expect(skill).toMatch(/## Sources\n/);
    expect(existsSync(join(plugin, "roles/code-reviewer/evals/plan-review-scenario-without-a-task.md"))).toBe(true);
  });
  it("start: the review runs after aidw analyze and before the transition to awaiting_approval", () => {
    const t = read("skills/start/SKILL.md");
    const analyze = t.indexOf("Run `aidw analyze <id>` and `aidw validate <id>`");
    const brief = t.indexOf("`aidw plan-review <id> --brief`");
    const gate = t.indexOf("`aidw transition <id> awaiting_approval` (it re-runs both checks");
    expect(analyze).toBeGreaterThan(0);
    expect(brief).toBeGreaterThan(analyze);
    expect(gate).toBeGreaterThan(brief);
  });
});
