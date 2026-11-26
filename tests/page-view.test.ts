import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { parsePage, renderPage } from "../src/page.js";
import { tempProject, write } from "./fixtures.js";

// Q8a / M9 (ADR-0017): every choice shows a View. These cover the CLI path end to end, hostile text inside a View,
// the edges of the yes-or-no exemption, and the rule as the guide states it.

function cli(root: string, argv: string[], stdin?: string) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s), ...(stdin === undefined ? {} : { stdin: () => stdin }) });
  return { code, out, err };
}

const CHOICE = `layout: questions
title: Sessions
questions:
  - id: Q1
    title: Where do sessions live?
    recommend: db
    why: One store to back up.
    options:
      - { key: db, name: In the database, summary: One store }
      - { key: redis, name: In Redis, summary: Fast }
`;
const withView = (src: string, view: string) => src.replace("    options:", `    view: ${view}\n    options:`);
const REFUSED = /questions\[Q1\]: a choice shows a View/;

describe("aidw page render and a choice without a View (Q8a)", () => {
  it("refuses the file end to end: exit 1, the problem named, no page written", () => {
    const root = tempProject();
    cli(root, ["init"]);
    write(root, ".aidw/run/pages/sessions.yaml", CHOICE);
    const r = cli(root, ["page", "render", "sessions"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/has 1 problem\(s\):\n {2}- questions\[Q1\]: a choice shows a View: give `view: \{kind, text\}`/);
    expect(r.out).not.toMatch(/Decision Page:/);
    expect(existsSync(join(root, ".aidw/run/pages/sessions.html"))).toBe(false);
  });

  it("refuses the same data given on stdin", () => {
    const root = tempProject();
    cli(root, ["init"]);
    const r = cli(root, ["page", "render", "sessions", "--stdin"], CHOICE);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(REFUSED);
    expect(existsSync(join(root, ".aidw/run/pages/sessions.html"))).toBe(false);
  });

  it("renders once a View is added, with the View in the written page", () => {
    const root = tempProject();
    cli(root, ["init"]);
    const r = cli(root, ["page", "render", "sessions", "--stdin"], withView(CHOICE, '{ kind: diff, text: " login\\n+  saveSessionRow" }'));
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const html = readFileSync(join(root, ".aidw/run/pages/sessions.html"), "utf8");
    expect(html).toContain('<figure class="view" data-kind="diff"><figcaption>diff</figcaption>');
    expect(html).toContain('<span class="add">+  saveSessionRow</span>');
  });

  it("renders a yes or no and a name without a View through the CLI", () => {
    const root = tempProject();
    cli(root, ["init"]);
    const yesNo = CHOICE.replace("recommend: db", "recommend: yes").replace("key: db,", "key: yes,").replace("key: redis,", "key: no,");
    expect(cli(root, ["page", "render", "yn", "--stdin"], yesNo).code).toBe(0);
    expect(cli(root, ["page", "render", "names", "--stdin"], CHOICE.replace("    recommend: db", "    naming: true\n    recommend: db")).code).toBe(0);
  });

  it("refuses a triage Decide block without a View through aidw page triage", () => {
    const root = tempProject();
    cli(root, ["init"]);
    const decide = "CAUSE: plan\nT03 cannot pass.\n\n## Decide\n```yaml\nquestion: How should T03 get lib/db.ts?\nrecommend: widen\nwhy: The scenario needs it.\noptions:\n  - { key: widen, name: Add lib/db.ts to touches, summary: Smallest change }\n  - { key: split, name: Split the task, summary: Two smaller tasks }\n```\n";
    write(root, "triage-t03.md", decide);
    const r = cli(root, ["page", "triage", "T03", "--notes-file", join(root, "triage-t03.md")]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/questions\[decide\]: a choice shows a View/);
    write(root, "triage-t03.md", decide.replace("options:", 'view: { kind: diff, text: "+ lib/db.ts" }\noptions:'));
    expect(cli(root, ["page", "triage", "T03", "--notes-file", join(root, "triage-t03.md")]).code).toBe(0);
  });

  it("renders the standing triage page (no Decide block) through the CLI", () => {
    const root = tempProject();
    cli(root, ["init"]);
    write(root, "triage-t04.md", "CAUSE: spec\nTwo scenarios contradict.\n");
    const r = cli(root, ["page", "triage", "T04", "--notes-file", join(root, "triage-t04.md")]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(readFileSync(join(root, ".aidw/run/pages/triage-t04.html"), "utf8").match(/data-kind="pseudocode"/g)).toHaveLength(2);
  });
});

describe("the yes-or-no exemption is exact (Q8a)", () => {
  it("does not exempt three options that include yes and no", () => {
    const three = CHOICE.replace("recommend: db", "recommend: yes")
      .replace("key: db,", "key: yes,")
      .replace("key: redis,", "key: no,")
      .replace("summary: Fast }", "summary: Fast }\n      - { key: later, name: Later, summary: Wait }");
    expect(parsePage("s", three).problems.join()).toMatch(REFUSED);
  });

  it("does not exempt keys that only look like yes or no", () => {
    const yn = CHOICE.replace("recommend: db", "recommend: y").replace("key: db,", "key: y,").replace("key: redis,", "key: n,");
    expect(parsePage("s", yn).problems.join()).toMatch(REFUSED);
  });

  it("does not exempt a multi choice, and naming must be true itself", () => {
    expect(parsePage("s", CHOICE.replace("    recommend: db", "    multi: true\n    recommend: [db]")).problems.join()).toMatch(REFUSED);
    expect(parsePage("s", CHOICE.replace("    recommend: db", "    naming: false\n    recommend: db")).problems.join()).toMatch(REFUSED);
  });

  it("does not count a broken View as a View", () => {
    const problems = parsePage("s", withView(CHOICE, "{ kind: mermaid, text: a }")).problems.join("\n");
    expect(problems).toMatch(/kind "mermaid" is not one of/);
    expect(problems).toMatch(REFUSED);
  });

  it("accepts each of the five kinds", () => {
    for (const kind of ["diff", "tree", "calltree", "component", "pseudocode"]) {
      expect(parsePage("s", withView(CHOICE, `{ kind: ${kind}, text: "a\\n  b" }`)).problems, kind).toEqual([]);
    }
  });
});

describe("hostile text in a View is shown as text (Q8a)", () => {
  const HOSTILE = '</pre></figure><script>alert(1)</script><img src=x onerror="alert(2)"> & &amp;';

  function rendered(src: string): string {
    const r = parsePage("s", src);
    expect(r.problems).toEqual([]);
    return renderPage(r.page);
  }
  const noLeak = (html: string) => {
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toMatch(/<\/pre><\/figure><script/);
  };

  it("escapes every kind of View on a question, including each diff line", () => {
    for (const kind of ["diff", "tree", "calltree", "component", "pseudocode"]) {
      const lines = kind === "diff" ? `+${HOSTILE}\n-${HOSTILE}\n@@ ${HOSTILE}\n ${HOSTILE}` : HOSTILE;
      const html = rendered(withView(CHOICE, JSON.stringify({ kind, text: lines })));
      noLeak(html);
      expect(html, kind).toContain("&lt;/pre&gt;&lt;/figure&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html, kind).toContain("&amp; &amp;amp;");
    }
  });

  it("gives each diff line exactly one class and escapes it", () => {
    const html = rendered(withView(CHOICE, JSON.stringify({ kind: "diff", text: `@@ -1 +1 @@\n ctx <b>\n+add <i>\n-del <u>` })));
    expect(html).toContain('<span class="hunk">@@ -1 +1 @@</span>\n<span class="ctx"> ctx &lt;b&gt;</span>\n<span class="add">+add &lt;i&gt;</span>\n<span class="del">-del &lt;u&gt;</span>');
  });

  it("escapes a View on an option", () => {
    const src = CHOICE.replace("summary: Fast }", `summary: Fast, view: ${JSON.stringify({ kind: "component", text: HOSTILE })} }`);
    noLeak(rendered(src));
  });

  it("escapes a View on a gate section", () => {
    const gate = `layout: gate\ntitle: Approve\nsections:\n  - id: stack\n    title: Stack\n    body: Next.js.\n    view: ${JSON.stringify({ kind: "tree", text: HOSTILE })}\n`;
    noLeak(rendered(gate));
  });

  it("refuses a hostile kind instead of writing it into an attribute", () => {
    const r = parsePage("s", withView(CHOICE, JSON.stringify({ kind: '"><script>alert(1)</script>', text: "a" })));
    expect(r.problems.join()).toMatch(/is not one of diff, tree, calltree, component, pseudocode/);
    expect(r.page.questions[0]?.views).toEqual([]);
  });
});

describe("the guide states the rule (Q8a, M9)", () => {
  const guide = readFileSync(join(__dirname, "../plugins/aidw/library/decision-pages.md"), "utf8");

  it("names the five kinds, the refusal, the exemptions and the chat's fenced View", () => {
    for (const kind of ["diff", "tree", "calltree", "component", "pseudocode"]) expect(guide).toContain(`| \`${kind}\` |`);
    expect(guide).toMatch(/aidw page render` refuses/);
    expect(guide).toMatch(/yes or no/);
    expect(guide).toMatch(/naming: true/);
    expect(guide).toMatch(/\*\*In the chat\*\*[\s\S]*fenced block/);
    expect(guide).toMatch(/```diff/);
  });

  it("says a single question after a design is asked in the chat with a summary, a link and a View (M9)", () => {
    expect(guide).toMatch(/One question after a design, in the chat\.\*\*[\s\S]{0,300}summary[\s\S]{0,100}link[\s\S]{0,100}View/);
  });
});
