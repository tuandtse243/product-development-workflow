import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const plugin = join(__dirname, "..", "plugins", "aidw");
const read = (p: string) => readFileSync(join(plugin, p), "utf8");

describe("writing rules for authoring Roles (I6, D5, D6)", () => {
  const a = read("library/author-artifacts.md");

  it("sub-headings state a finding, prose is plain, and the author makes one pass to shorten (I6)", () => {
    expect(a).toMatch(/sub-heading[^\n]*states? (?:the|a) finding/i);
    expect(a).toMatch(/headings the CLI checks[^\n]*stay/i);
    expect(a).toMatch(/plain/i);
    expect(a).toMatch(/one (?:more )?pass/i);
  });

  it("a technical recommendation cites evidence: path and lines, or a source for greenfield (D5)", () => {
    expect(a).toMatch(/recommendation[^\n]*evidence/i);
    expect(a).toContain("Existing System Report");
    expect(a).toMatch(/greenfield/i);
    expect(a).toMatch(/:\d+-\d+/); // an example with a line range
  });

  it("a decision records what was chosen, why, and the options set aside (D6)", () => {
    expect(a).toMatch(/Design Question/);
    expect(a).toMatch(/^ {2}Why: /m);
    expect(a).toMatch(/^ {2}Rejected: /m);
    expect(a).toContain("Rejected: none");
    expect(a).toMatch(/plain indented lines, not sub-bullets/);
  });

  it("every authoring agent carries the rules", () => {
    expect(read("agents/software-architect.md")).toMatch(/^ {2}Rejected: /m);
  });

  it("step 9 of /aidw:start writes Decisions to honor with Why and Rejected (D6)", () => {
    const step9 = read("skills/start/SKILL.md").split("## 9. Analyze and present")[1] ?? "";
    expect(step9).toMatch(/^ {5}Why: /m);
    expect(step9).toMatch(/^ {5}Rejected: /m);
    expect(step9).toMatch(/plain indented lines, not sub-bullets/);
  });
});

describe("implementers follow a precedence and report a mismatch in three lines (I10)", () => {
  const t = read("library/implement-a-task.md");

  it("ranks the documents in the decided order", () => {
    const order = ["brief", "ADRs", "Program Design", "specs", "requirements", "analysis", "intake"];
    const at = order.map((w) => t.indexOf(w, t.search(/precedence/i)));
    expect(at.every((x) => x > 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(t).toMatch(/brief and `tasks\.yaml`/);
  });

  it("reports a mismatch as Expected, Found, Why this matters on a BLOCKED reply", () => {
    expect(t).toMatch(/^Expected: /m);
    expect(t).toMatch(/^Found: /m);
    expect(t).toMatch(/^Why this matters: /m);
    expect(t).toMatch(/BLOCKED/);
  });

  it("the orchestrator sends a BLOCKED mismatch to the author as a Deviation, not to a retry or not-built", () => {
    const run = read("skills/run/SKILL.md");
    const at = run.indexOf("`BLOCKED: documents disagree`");
    const para = run.slice(at, run.indexOf("\n4. ", at));
    expect(at).toBeGreaterThan(0);
    expect(para).toMatch(/not an environment cause/);
    expect(para).toMatch(/not retried/);
    expect(para).toMatch(/aidw deviation open [^`]*--task <T>[^`]*--reason "<the three lines>"/);
    expect(para.split("\n").every((l) => l.length <= 125)).toBe(true);
  });

  it("every implementing agent carries it", () => {
    expect(read("agents/backend.md")).toMatch(/^Why this matters: /m);
  });
});

describe("discovery asks product questions, and the app answers what it already does (D1, D3)", () => {
  const start = read("skills/start/SKILL.md");
  const pm = read("roles/product-manager/role.md");
  const frame = read("roles/product-manager/skills/discovery-frame.md");

  it("the orchestrator sets the Size and never asks it on a discovery page (D1)", () => {
    expect(start).toMatch(/set the size yourself[\s\S]{0,200}not a question on a discovery page/i);
    expect(pm).toMatch(/Set the size yourself/);
    expect(pm).toMatch(/Do not ask the user/);
    expect(frame).toMatch(/size of the Change is not a question/i);
  });

  it("a question whose options are mechanisms becomes a product rule, the mechanism is deferred (D1)", () => {
    for (const t of [start, pm, frame]) {
      expect(t).toMatch(/mechanism/i);
      expect(t).toMatch(/Deferred to\s+architecture/);
    }
    expect(start).toMatch(/Rewrite such a question\s+as the product rule/);
  });

  it("an answer that only copies the app is assumed with file:line, not asked (D3)", () => {
    expect(start).toMatch(/Before asking the user anything in chat, check whether your\s+recommended answer only copies how the app already behaves/);
    expect(start).toContain("Assumed: <answer> (copies <file:line>)");
    expect(start).toMatch(/which the gate shows/);
  });

  it("no internal note reaches the user, and every user line is in the user's language (D3)", () => {
    expect(start).toMatch(/Never write an internal note/);
    expect(start).toMatch(/in the user's language/);
  });
});

describe("backlog skill rules (B7, B8)", () => {
  const skill = read("skills/start/SKILL.md");

  it("step 5 reuses the tokens without a Decision Page (B7)", () => {
    const step5 = skill.split("## 5. Design decision")[1]?.split("## 6.")[0] ?? "";
    expect(step5).toContain(".aidw/design/tokens.yaml");
    expect(step5).toContain('aidw decide design-needed reuse-existing --reason "<why>"');
    expect(step5).toMatch(/no new kind of screen/);
    expect(step5).toMatch(/one line in the chat/);
    expect(step5).toMatch(/no Decision Page/i);
  });

  it("intake asks for the test browser once, and step 8 never asks (B8)", () => {
    const step1 = skill.split("## 1. Intake")[1]?.split("## 1b.")[0] ?? "";
    expect(step1).toMatch(/Test browser preflight/);
    expect(step1).toContain("aidw browser start");
    expect(step1).toMatch(/likely has UI/);
    const step8 = skill.split("## 8. Test plan")[1]?.split("## 9.")[0] ?? "";
    expect(step8).toContain("aidw browser status");
    expect(step8).toMatch(/Do not ask a second time/);
    expect(step8).toMatch(/aidw run` \(the runner path\) starts\s+the browser itself/);
    expect(step8).not.toMatch(/ask the user to run `aidw browser start`/);
  });
});
