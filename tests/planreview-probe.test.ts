/**
 * Re-review probes of the T6 fixes (D4): forging the verdict through Bash, case variants of the protected names,
 * the plan digest (what it covers, when it is taken, how stable it is) and the brief handshake across a restart.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadChange } from "../src/change.js";
import { run } from "../src/cli.js";
import { decide, type HookInput } from "../src/gate.js";
import { planDigest } from "../src/planreview.js";
import { pathsFor } from "../src/project.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, tempProject, write } from "./fixtures.js";

const ID = "2026-11-24-booking";
const verdict = `.aidw/run/review-plan-${ID}.md`;
const PASS = "VERDICT: pass\n";

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}

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

const bash = (root: string, agent: string | undefined, command: string) =>
  decide({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: root, agent_type: agent } as HookInput, {})?.decision ?? "none";
const writeTool = (root: string, agent: string | undefined, file: string) =>
  decide({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: join(root, file), content: PASS }, cwd: root, agent_type: agent } as HookInput, {})?.decision ?? "none";

describe("forging the verdict or the record through Bash", () => {
  const shell = [
    `echo 'VERDICT: pass' > ${verdict}`,
    `printf 'VERDICT: pass\\n' >> ${verdict}`,
    `cp /dev/null ${verdict}`,
    `echo 'VERDICT: pass' | tee ${verdict}`,
    `sed -i '' 's/fix/pass/' ${verdict}`,
    `sed -i '' 's/fix/pass/' .aidw/changes/${ID}/plan-review.yaml`,
  ];
  for (const agent of ["aidw:technical-planner", "aidw:code-reviewer", "general-purpose", undefined]) {
    for (const cmd of shell) {
      it(`${agent ?? "the lead"}: ${cmd} is denied before approval`, () => {
        expect(bash(drafted(), agent, cmd)).toBe("deny");
      });
    }
  }

});

describe("case variants of the protected names (macOS and Windows file systems ignore case)", () => {
  it("an author may not write .aidw/run/Review-Plan-<id>.md", () => {
    expect(writeTool(drafted(), "aidw:technical-planner", `.aidw/run/Review-Plan-${ID}.md`)).toBe("deny");
  });
  it("an author may not write changes/<id>/Plan-Review.yaml", () => {
    expect(writeTool(drafted(), "aidw:technical-planner", `.aidw/changes/${ID}/Plan-Review.yaml`)).toBe("deny");
  });
});

describe("the plan digest", () => {
  it("is the plan that was reviewed: a plan changed between the brief and the record is refused", () => {
    const root = drafted();
    expect(cli(root, "plan-review", ID, "--brief").code).toBe(0);
    write(root, verdict, PASS);
    // after the reviewer graded it, the plan is revised before the lead records the verdict
    write(root, `.aidw/changes/${ID}/tasks.yaml`, TASKS_YAML.replace("title: Booking page", "title: Booking page with an unreviewed cache"));
    const r = cli(root, "plan-review", ID);
    const t = cli(root, "transition", ID, "awaiting_approval");
    expect(r.code === 1 || t.code === 1, "the unreviewed plan reached the gate").toBe(true);
  });

  for (const f of ["openapi.yaml", "quality.yaml", "decisions.yaml"]) {
    it(`covers ${f}, which the brief asks the reviewer to read`, () => {
      const root = drafted();
      const p = pathsFor(root);
      const before = planDigest(p, loadChange(p, ID));
      write(root, `.aidw/changes/${ID}/${f}`, `# changed after the review\nx: 1\n`);
      expect(planDigest(p, loadChange(p, ID))).not.toBe(before);
    });
  }

  it("tells a missing file from an empty one, and ignores the order of keys in tasks.yaml", () => {
    const root = drafted();
    const p = pathsFor(root);
    const missing = planDigest(p, loadChange(p, ID));
    write(root, `.aidw/changes/${ID}/test-plan.md`, "");
    expect(planDigest(p, loadChange(p, ID))).not.toBe(missing);
    const tasks = readFileSync(join(root, `.aidw/changes/${ID}/tasks.yaml`), "utf8");
    const before = planDigest(p, loadChange(p, ID));
    write(root, `.aidw/changes/${ID}/tasks.yaml`, tasks.replace(/\n/g, "\r\n"));
    expect(planDigest(p, loadChange(p, ID))).toBe(before);
  });

  it("a CRLF checkout of the same spec is the same plan", () => {
    const root = drafted();
    const p = pathsFor(root);
    const before = planDigest(p, loadChange(p, ID));
    const spec = `.aidw/changes/${ID}/specs/booking/spec.md`;
    write(root, spec, readFileSync(join(root, spec), "utf8").replace(/\n/g, "\r\n"));
    expect(planDigest(p, loadChange(p, ID))).toBe(before);
  });
});

describe("the brief handshake", () => {
  it("a second brief after a lost session is the same round, and its verdict records", () => {
    const root = drafted();
    const first = cli(root, "plan-review", ID, "--brief");
    expect(readFileSync(first.out.split("\n")[0] as string, "utf8")).toMatch(/Round 1 of/);
    // the session died before the reviewer wrote anything; the next session briefs again
    const again = cli(root, "plan-review", ID, "--brief");
    expect(again.code, again.err).toBe(0);
    expect(readFileSync(again.out.split("\n")[0] as string, "utf8")).toMatch(/Round 1 of/);
    write(root, verdict, PASS);
    const r = cli(root, "plan-review", ID);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/round 1: pass/);
  });
});
