import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { checkFragment, parseAnswers, parsePage, renderPage, triageData } from "../src/page.js";
import { tempProject, write } from "./fixtures.js";

function cli(root: string, argv: string[], stdin?: string) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s), ...(stdin === undefined ? {} : { stdin: () => stdin }) });
  return { code, out, err };
}

const HOSTING = `layout: questions
title: Where does the app run?
lang: vi
role: software-architect
questions:
  - id: Q1
    title: Hosting
    criteria: [Cost, Ops work]
    recommend: vercel
    why: One command to deploy and a preview per branch.
    decision: hosting-target
    view:
      kind: diff
      text: |2
         app/
        +vercel.json
        -Dockerfile
    options:
      - key: vercel
        name: Vercel
        pros: [Preview per branch]
        cons: [Long jobs live elsewhere]
        facts: { Cost: 0 to 20 USD, Ops work: almost none }
      - key: vps
        name: Own VPS
        pros: [Full control]
        cons: [You patch it]
        facts: { Cost: 6 USD, Ops work: high }
        html: '<div style="color:red">mock <b>screen</b></div>'
  - id: Q2
    title: Which regions?
    multi: true
    recommend: [eu]
    why: The users are in Europe.
    options:
      - { key: eu, name: Europe, summary: Close to the users, view: { kind: tree, text: "eu-west-1/\\n  app\\n  db" } }
      - { key: us, name: United States, summary: Cheapest }
  - id: Q3
    title: What is the product called?
    suggest: Notes
`;

const page = (text = HOSTING, name = "hosting") => parsePage(name, text);

describe("the data of a Decision Page", () => {
  it("reads questions with options, criteria and an open question", () => {
    const r = page();
    expect(r.problems).toEqual([]);
    expect(r.page.questions.map((q) => [q.id, q.options.length, q.multi])).toEqual([
      ["Q1", 2, false],
      ["Q2", 2, true],
      ["Q3", 0, false],
    ]);
    expect(r.page.version).toMatch(/^[0-9a-f]{6}$/);
  });

  it("names the field that is wrong", () => {
    const bad = HOSTING.replace("recommend: vercel", "recommend: fly").replace("facts: { Cost: 6 USD, Ops work: high }", "facts: { Cost: 6 USD }").replace("title: Which regions?", "title: ''");
    const { problems } = page(bad);
    expect(problems.join("\n")).toMatch(/questions\[Q1\]\.recommend: "fly" is not an option key/);
    expect(problems.join("\n")).toMatch(/options\[vps\]\.facts: no value for the criterion "Ops work"/);
    expect(problems.join("\n")).toMatch(/questions\[Q2\]: title is missing/);
  });

  it("wants a recommendation and its reason on every choice", () => {
    const { problems } = page(HOSTING.replace("    recommend: [eu]\n", "").replace("    why: The users are in Europe.\n", ""));
    expect(problems).toEqual([expect.stringMatching(/questions\[Q2\]: recommend is missing/)]);
  });

  it("refuses script and network loads in a free slot", () => {
    expect(checkFragment('<div style="color:red">x</div><svg viewBox="0 0 1 1"><rect fill="red" width="1" height="1"/></svg>')).toBeNull();
    expect(checkFragment('<img src="data:image/png;base64,AAAA">')).toBeNull();
    for (const html of ["<script>alert(1)</script>", '<img src="https://x.test/a.png">', '<a href="//x.test">x</a>', '<p onclick="x()">x</p>', "<style>@import 'a.css'</style>", '<div style="background:url(http://x.test/a)">', '<a href="javascript:x()">x</a>', "</template><p>out</p>"])
      expect(checkFragment(html), html).toMatch(/static HTML, CSS and SVG only/);
    expect(page(HOSTING.replace('<div style="color:red">mock <b>screen</b></div>', "<script>1</script>")).problems.join()).toMatch(/options\[vps\]\.html contains the <script> element/);
  });
});

describe("the View of a question (ADR-0017)", () => {
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

  it("reads view as {kind, text} on a question, an option or a list of them, keeping the text's indentation", () => {
    const { page: p, problems } = page();
    expect(problems).toEqual([]);
    expect(p.questions[0]?.views).toEqual([{ kind: "diff", text: " app/\n+vercel.json\n-Dockerfile" }]);
    expect(p.questions[1]?.options[0]?.views).toEqual([{ kind: "tree", text: "eu-west-1/\n  app\n  db" }]);
    const two = parsePage("s", CHOICE.replace("    options:", '    view: [{ kind: pseudocode, text: "on(login)\\n  save session" }, { kind: calltree, text: "login\\n  saveSession" }]\n    options:'));
    expect(two.problems).toEqual([]);
    expect(two.page.questions[0]?.views.map((v) => v.kind)).toEqual(["pseudocode", "calltree"]);
  });

  it("refuses a question with options that has neither a view nor html, and names the fix", () => {
    const { problems } = parsePage("s", CHOICE);
    expect(problems).toEqual([expect.stringMatching(/questions\[Q1\]: a choice shows a View: give `view: \{kind, text\}`.*diff, tree, calltree, component, pseudocode.*or an `html` mock/)]);
  });

  it("accepts the view or the html on the question or on any option", () => {
    expect(parsePage("s", CHOICE.replace("summary: Fast }", 'summary: Fast, view: { kind: component, text: "<App>\\n  <RedisProvider>" } }')).problems).toEqual([]);
    expect(parsePage("s", CHOICE.replace("summary: Fast }", "summary: Fast, html: '<p>mock</p>' }")).problems).toEqual([]);
    expect(parsePage("s", CHOICE.replace("    options:", "    html: '<p>mock</p>'\n    options:")).problems).toEqual([]);
  });

  it("exempts a yes or no, a name and an open question", () => {
    const yesNo = CHOICE.replace("recommend: db", "recommend: yes").replace("key: db,", "key: yes,").replace("key: redis,", "key: No,");
    expect(parsePage("s", yesNo).problems).toEqual([]);
    expect(parsePage("s", CHOICE.replace("    recommend: db", "    naming: true\n    recommend: db")).problems).toEqual([]);
    expect(parsePage("s", "layout: questions\ntitle: T\nquestions:\n  - { id: Q1, title: What is it called?, suggest: Notes }\n").problems).toEqual([]);
  });

  it("names a bad view: an unknown kind, empty text, or not an object", () => {
    const bad = (view: string) => parsePage("s", CHOICE.replace("    options:", `    view: ${view}\n    options:`)).problems.join("\n");
    expect(bad("{ kind: mermaid, text: a }")).toMatch(/questions\[Q1\]\.view: kind "mermaid" is not one of diff, tree, calltree, component, pseudocode/);
    expect(bad("{ kind: diff, text: '' }")).toMatch(/questions\[Q1\]\.view: text is missing/);
    expect(bad("just words")).toMatch(/questions\[Q1\]\.view: give \{kind, text\}/);
    expect(bad(`{ kind: tree, text: "${"x".repeat(20_001)}" }`)).toMatch(/questions\[Q1\]\.view: text is 20001 characters; the limit is 20000/);
  });

  it("is rendered as escaped text, a diff with its lines coloured", () => {
    const html = renderPage(page().page);
    expect(html).toContain('<figure class="view" data-kind="diff">');
    expect(html).toMatch(/<span class="ctx"> app\/<\/span>\n<span class="add">\+vercel\.json<\/span>\n<span class="del">-Dockerfile<\/span>/);
    expect(html).toMatch(/<figure class="view" data-kind="tree"><figcaption>file tree<\/figcaption><pre>eu-west-1\/\n {2}app\n {2}db<\/pre><\/figure>/);
    const x = renderPage(parsePage("s", CHOICE.replace("    options:", '    view: { kind: component, text: "<App>\\n  <script>x</script>" }\n    options:')).page);
    expect(x).toContain("&lt;App&gt;\n  &lt;script&gt;x&lt;/script&gt;");
    expect(x).not.toContain("<script>x</script>");
  });

  it("can stand on a gate section, which is a yes or no and needs none", () => {
    const g = parsePage("gate", `${GATE}    view: { kind: diff, text: "+app/\\n+db/" }\n`);
    expect(g.problems).toEqual([]);
    expect(g.page.sections[1]?.views).toEqual([{ kind: "diff", text: "+app/\n+db/" }]);
    expect(renderPage(g.page)).toMatch(/data-sec="stack">[\s\S]*<span class="add">\+app\/<\/span>/);
    expect(parsePage("gate", GATE).problems).toEqual([]);
  });
});

describe("the rendered page", () => {
  const html = renderPage(page().page);

  it("is one file with nothing loaded from the network", () => {
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(html).not.toMatch(/<link\b/);
  });

  it("lays options side by side with the same criteria rows and preselects the recommendation", () => {
    expect(html.match(/<dt>Cost<\/dt>/g)).toHaveLength(2);
    expect(html).toMatch(/id="q-Q1:vercel" value="vercel" checked/);
    expect(html).not.toMatch(/id="q-Q1:vps" value="vps" checked/);
    expect(html).toMatch(/type="checkbox" name="q-Q2"/);
    expect(html).toContain("Đề xuất");
    expect(html).toContain("Sao chép câu trả lời");
  });

  it("keeps a free fragment in its own shadow tree and escapes everything else", () => {
    expect(html).toContain('<template shadowrootmode="open"><div style="color:red">mock <b>screen</b></div></template>');
    const x = renderPage(page(HOSTING.replace("title: Hosting", 'title: "<img src=x> `code`"')).page);
    expect(x).toContain("&lt;img src=x&gt; <code>code</code>");
  });
});

describe("the answer the user pastes", () => {
  const p = page().page;
  const head = `aidw page hosting ${p.version}`;

  it("is accepted when it matches the page, and names the command of a Decision Point", () => {
    const a = parseAnswers(p, `some chatter\n${head}\nQ1: vercel | note: needs a nightly cron\nQ2: eu, us\nQ3: > Notes\nnote: ship in May\n`);
    expect(a.problems).toEqual([]);
    expect(a.answers.map((x) => [x.id, x.keys, x.text, x.note])).toEqual([
      ["Q1", ["vercel"], "", "needs a nightly cron"],
      ["Q2", ["eu", "us"], "", ""],
      ["Q3", [], "Notes", ""],
    ]);
    expect(a.note).toBe("ship in May");
    expect(a.next).toEqual([expect.stringMatching(/^aidw decide hosting-target vercel --reason/)]);
  });

  it("is refused when a question is missing, a key is unknown or one option is expected", () => {
    const a = parseAnswers(p, `${head}\nQ1: vercel, vps\nQ2: asia\n`);
    expect(a.ok).toBe(false);
    expect(a.problems.join("\n")).toMatch(/Q1 takes one option, got 2/);
    expect(a.problems.join("\n")).toMatch(/Q2: "asia" is not an option \(options: eu, us\)/);
    expect(a.problems.join("\n")).toMatch(/Q3 \(What is the product called\?\) has no line/);
  });

  it("is refused when it was copied from an older page or another page", () => {
    expect(parseAnswers(p, "aidw page hosting 000000\nQ1: vercel\nQ2: eu\nQ3: > x\n").problems.join()).toMatch(/the page changed after this answer was copied/);
    expect(parseAnswers(p, `aidw page stack ${p.version}\nQ1: vercel\nQ2: eu\nQ3: > x\n`).problems.join()).toMatch(/is for the page "stack"/);
    expect(parseAnswers(p, "Q1: vercel\nQ2: eu\nQ3: > x\n").problems.join()).toMatch(/first line .* is missing/);
  });

  it("takes a note alone as the answer of a choice", () => {
    expect(parseAnswers(p, `${head}\nQ1:  | note: use Fly.io instead\nQ2: eu\nQ3: > x\n`).ok).toBe(true);
    expect(parseAnswers(p, `${head}\nQ1: \nQ2: eu\nQ3: > x\n`).problems.join()).toMatch(/Q1 \(Hosting\) is not answered/);
  });
});

const GATE = `layout: gate
title: Approve the notes app
sections:
  - id: scope
    title: Scope
    points: [Create and edit notes, No sharing in the MVP]
  - id: stack
    title: Stack
    body: Next.js on Vercel with Postgres.
`;

describe("a gate page", () => {
  const g = parsePage("gate", GATE).page;
  const head = `aidw page gate ${g.version}`;

  it("lets every section be agreed or sent back", () => {
    const html = renderPage(g);
    expect(html).toMatch(/name="s-scope" id="s-scope-ok" value="ok"/);
    expect(html).toMatch(/name="s-stack" id="s-stack-change" value="change"/);
  });

  it("sends the user to approve only when every section is agreed", () => {
    const ok = parseAnswers(g, `${head}\nscope: ok\nstack: ok\n`);
    expect(ok.ok).toBe(true);
    expect(ok.next.join()).toMatch(/the user approves with \/aidw:approve/);
    const change = parseAnswers(g, `${head}\nscope: ok\nstack: change | note: use SQLite\n`);
    expect(change.ok).toBe(true);
    expect(change.next.join()).toMatch(/1 section\(s\) need a change/);
  });

  it("refuses a section left unmarked, and a change that does not say what", () => {
    expect(parseAnswers(g, `${head}\nscope: ok\nstack: \n`).problems.join()).toMatch(/section "Stack" \(stack\) is not marked/);
    expect(parseAnswers(g, `${head}\nscope: ok\nstack: change\n`).problems.join()).toMatch(/needs a change but the note does not say what/);
  });
});

describe("aidw page", () => {
  it("renders the page under .aidw/run/pages and prints its link, not its questions", () => {
    const root = tempProject();
    cli(root, ["init"]);
    write(root, ".aidw/run/pages/hosting.yaml", HOSTING);
    const r = cli(root, ["page", "render", "hosting"]);
    expect(r.err).toBe("");
    expect(r.out).toMatch(/^Decision Page: file:\/\/.*\/\.aidw\/run\/pages\/hosting\.html\n3 question\(s\)/);
    expect(r.out).toMatch(/aidw page answers hosting/);
    expect(r.out).not.toContain("Preview per branch");
    expect(readFileSync(join(root, ".aidw/run/pages/hosting.html"), "utf8")).toContain("Preview per branch");
    expect(readFileSync(join(root, ".aidw/.gitignore"), "utf8")).toMatch(/^run\/$/m);
  });

  it("takes the data on stdin for a session that may not write files", () => {
    const root = tempProject();
    cli(root, ["init"]);
    expect(cli(root, ["page", "render", "gate", "--stdin"], GATE).code).toBe(0);
    expect(existsSync(join(root, ".aidw/run/pages/gate.html"))).toBe(true);
  });

  it("refuses bad data with every problem listed", () => {
    const root = tempProject();
    cli(root, ["init"]);
    write(root, ".aidw/run/pages/hosting.yaml", HOSTING.replace("recommend: vercel", "recommend: fly"));
    const r = cli(root, ["page", "render", "hosting"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/has 1 problem\(s\):\n {2}- questions\[Q1\]\.recommend: "fly" is not an option key/);
    expect(cli(root, ["page", "render", "nothing"]).err).toMatch(/no page data at \.aidw\/run\/pages\/nothing\.yaml/);
  });

  it("checks the pasted answer and says what to record", () => {
    const root = tempProject();
    cli(root, ["init"]);
    write(root, ".aidw/run/pages/hosting.yaml", HOSTING);
    const v = page().page.version;
    const ok = cli(root, ["page", "answers", "hosting", "--text", `aidw page hosting ${v}\nQ1: vercel\nQ2: eu\nQ3: > Notes`]);
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/^OK hosting/);
    expect(ok.out).toMatch(/Q1 Hosting: vercel \(Vercel\)/);
    expect(ok.out).toMatch(/NEXT: aidw decide hosting-target vercel/);
    const bad = cli(root, ["page", "answers", "hosting"], `aidw page hosting ${v}\nQ1: vercel\n`);
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/^REFUSED hosting: 2 problem\(s\)/);
  });
});

const ID = "2026-11-14-audit";
const SECURITY = "LENS: security\n## Findings\n- [high] app/api/bookings/route.ts: no authorization check before cancel\n- [low] README.md: secrets example uses a real-looking key\n## Not covered\nNone\n";

describe("aidw page audit", () => {
  it("turns the findings into a pick list whose answer feeds aidw audit picks", () => {
    const root = tempProject();
    cli(root, ["init"]);
    cli(root, ["change", "new", ID, "--workflow", "audit", "--title", "Audit the booking app"]);
    write(root, `.aidw/changes/${ID}/intake.md`, "# Intake\n\nAudit the whole project before launch.\n");
    for (const s of ["intake", "analyzing"]) expect(cli(root, ["transition", ID, s]).code, s).toBe(0);
    expect(cli(root, ["decide", "audit-lenses", "security", "--reason", "launch risk"]).code).toBe(0);
    write(root, ".aidw/run/audit-security.md", SECURITY);
    const r = cli(root, ["page", "audit"]);
    expect(r.err).toBe("");
    expect(r.out).toMatch(/2 item\(s\) to pick from, 1 recommended/);
    const name = `audit-${ID}`;
    const html = readFileSync(join(root, `.aidw/run/pages/${name}.html`), "utf8");
    expect(html).toMatch(/id="p-F-01" value="F-01" checked/);
    const version = /"version":"([0-9a-f]{6})"/.exec(html)?.[1];
    const a = cli(root, ["page", "answers", name, "--text", `aidw page ${name} ${version}\npicks: F-01, F-02`]);
    expect(a.out).toMatch(/NEXT: aidw audit picks F-01,F-02/);
    expect(cli(root, ["page", "answers", name, "--text", `aidw page ${name} ${version}\npicks: F-09`]).out).toMatch(/"F-09" is not an item/);
  });
});

describe("the page of an escalated task", () => {
  it("offers the options the diagnosis gives, or the two standing ways out", () => {
    const decide = "CAUSE: plan\nT03 cannot pass: touches blocks lib/db.ts.\n\n## Decide\n```yaml\nquestion: How should T03 get lib/db.ts?\nrecommend: widen\nwhy: The scenario needs it.\nview: { kind: diff, text: \"  touches:\\n+   - lib/db.ts\" }\noptions:\n  - { key: widen, name: Add lib/db.ts to touches, summary: Smallest change }\n  - { key: split, name: Split the task, summary: Two smaller tasks }\n```\n";
    const withBlock = parsePage("triage-t03", JSON.stringify(triageData({ task: "T03", cause: "plan", diagnosis: decide })));
    expect(withBlock.problems).toEqual([]);
    expect(withBlock.page.questions[0]?.options.map((o) => o.key)).toEqual(["widen", "split"]);
    expect(withBlock.page.intro).toBe("T03 cannot pass: touches blocks lib/db.ts.");
    const bare = parsePage("triage-t03", JSON.stringify(triageData({ task: "T03", cause: "spec", diagnosis: "CAUSE: spec\nTwo scenarios contradict.\n" })));
    expect(bare.problems).toEqual([]);
    expect(bare.page.questions[0]?.options.map((o) => o.key)).toEqual(["fix-and-resume", "change-scope"]);
    expect(bare.page.questions[0]?.options.every((o) => o.views.length === 1)).toBe(true);
    const noView = parsePage("triage-t03", JSON.stringify(triageData({ task: "T03", cause: "plan", diagnosis: decide.replace(/view: .*\n/, "") })));
    expect(noView.problems.join()).toMatch(/questions\[decide\]: a choice shows a View/);
  });
});

describe("the examples of the Decision Page guide", () => {
  const guide = readFileSync(join(__dirname, "../plugins/aidw/library/decision-pages.md"), "utf8");
  // Whole pages start with `layout:`; the snippets of the layouts section are checked in page-layouts.test.ts.
  const blocks = [...guide.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1] as string).filter((b) => /^layout:/.test(b));

  it("are valid page data, one per layout", () => {
    expect(blocks).toHaveLength(3);
    const pages = blocks.map((b, i) => parsePage(`example-${i}`, b));
    expect(pages.flatMap((p) => p.problems)).toEqual([]);
    expect(pages.map((p) => p.page.layout)).toEqual(["questions", "picks", "gate"]);
  });

  it("the triage skill's Decide block gives a valid question", () => {
    const skill = readFileSync(join(__dirname, "../plugins/aidw/roles/software-architect/skills/triage.md"), "utf8");
    const block = /## Decide\n\s*```yaml\n[\s\S]*?```/.exec(skill)?.[0].replace(/^ {2}/gm, "") ?? "";
    const r = parsePage("triage-t03", JSON.stringify(triageData({ task: "T03", cause: "plan", diagnosis: `CAUSE: plan\nWhy.\n\n${block}\n` })));
    expect(r.problems).toEqual([]);
    expect(r.page.questions[0]?.options.map((o) => o.key)).toEqual(["widen", "split"]);
    expect(r.page.questions[0]?.criteria).toEqual(["Rework", "Risk"]);
    expect(r.page.questions[0]?.views).toEqual([{ kind: "diff", text: " - id: T03\n   touches:\n     - app/notes/page.tsx\n+    - lib/db.ts" }]);
  });
});
