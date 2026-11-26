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
  });

  it("every authoring agent carries the rules", () => {
    expect(read("agents/software-architect.md")).toMatch(/^ {2}Rejected: /m);
  });

  it("step 9 of /aidw:start writes Decisions to honor with Why and Rejected (D6)", () => {
    const step9 = read("skills/start/SKILL.md").split("## 9. Analyze and present")[1] ?? "";
    expect(step9).toMatch(/^ {5}Why: /m);
    expect(step9).toMatch(/^ {5}Rejected: /m);
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

  it("every implementing agent carries it", () => {
    expect(read("agents/backend.md")).toMatch(/^Why this matters: /m);
  });
});
