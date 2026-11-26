import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { beforeAfterSection } from "../src/beforeafter.js";
import { run } from "../src/cli.js";
import { parsePage, renderPage } from "../src/page.js";
import { tempProject, write } from "./fixtures.js";

// Q8b, D4, M5 (ADR-0017): layouts modelled on the html-effectiveness examples (01 approaches, 04 walkthrough, 16 plan,
// 17 before-after) and up to 4 metrics on an option.

function cli(root: string, argv: string[], stdin?: string) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s), ...(stdin === undefined ? {} : { stdin: () => stdin }) });
  return { code, out, err };
}

const APPROACHES = `layout: questions
title: Debounced search
questions:
  - id: Q1
    title: How is the search debounced?
    layout: approaches
    recommend: hook
    why: Reused in three places and easy to test.
    options:
      - key: inline
        name: Inline effect
        summary: The logic lives in the component.
        pros: [Nothing new to learn, No dependency]
        cons: [Duplicated wherever search exists]
        view: { kind: pseudocode, text: "on input: restart a 300 ms timer\\nwhen it fires: search" }
        metrics:
          - { name: Bundle, value: +0 kb }
          - { name: Testability, value: medium, why: needs the component mounted }
      - key: hook
        name: useDebounce hook
        pros: [One import reused]
        cons: [One more file]
        view: { kind: tree, text: "src/\\n  hooks/useDebounce.ts" }
        metrics:
          - { name: Testability, value: high, why: a pure hook with fake timers }
          - { name: Bundle, value: +0.2 kb }
`;

const parse = (src: string) => parsePage("p", src);
const problemsOf = (src: string) => parse(src).problems;

describe("metrics on an option (D4, M5)", () => {
  it("reads up to 4 metrics, a figure with its unit or a level with why", () => {
    const { page, problems } = parse(APPROACHES);
    expect(problems).toEqual([]);
    expect(page.questions[0]?.options[0]?.metrics).toEqual([
      { name: "Bundle", value: "+0 kb", why: "" },
      { name: "Testability", value: "medium", why: "needs the component mounted" },
    ]);
  });

  it("refuses more than 4 metrics on an option", () => {
    const five = APPROACHES.replace(
      "          - { name: Testability, value: medium, why: needs the component mounted }\n",
      "          - { name: Testability, value: medium, why: needs the component mounted }\n          - { name: A, value: 1 ms }\n          - { name: B, value: 2 ms }\n          - { name: C, value: 3 ms }\n",
    );
    expect(problemsOf(five)).toContain("questions[Q1].options[inline].metrics: 5 metrics; give at most 4, the ones that really differ");
  });

  it("refuses a level without why, a bare number and a word that is neither", () => {
    const p = problemsOf(
      APPROACHES.replace("{ name: Testability, value: medium, why: needs the component mounted }", "{ name: Testability, value: medium }").replace("{ name: Bundle, value: +0.2 kb }", "{ name: Bundle, value: '3' }"),
    );
    expect(p).toContain('questions[Q1].options[inline].metrics[Testability]: "medium" is a level: say why in `why`');
    expect(p).toContain('questions[Q1].options[hook].metrics[Bundle]: "3" is neither a figure with its unit (e.g. "120 ms", "+0.2 kb") nor low, medium or high');
    expect(problemsOf(APPROACHES.replace("value: high, why", "value: good, why"))).toContain(
      'questions[Q1].options[hook].metrics[Testability]: "good" is neither a figure with its unit (e.g. "120 ms", "+0.2 kb") nor low, medium or high',
    );
  });

  it("refuses a metric without a name, one named twice, and one that another option does not name", () => {
    expect(problemsOf(APPROACHES.replace("{ name: Bundle, value: +0 kb }", "{ value: +0 kb }"))).toContain("questions[Q1].options[inline].metrics[1]: name is missing");
    expect(problemsOf(APPROACHES.replace("{ name: Bundle, value: +0 kb }", "{ name: Testability, value: 3 ms }"))).toContain('questions[Q1].options[inline].metrics: metric "Testability" appears twice');
    expect(problemsOf(APPROACHES.replace("          - { name: Bundle, value: +0.2 kb }\n", ""))).toContain(
      'questions[Q1].options[hook].metrics: no "Bundle"; every option names the same metrics so they line up',
    );
  });

  it("refuses metrics that are not a list", () => {
    expect(problemsOf(APPROACHES.replace(/        metrics:\n          - \{ name: Bundle, value: \+0 kb \}\n          - \{ name: Testability, value: medium, why: needs the component mounted \}\n/, "        metrics: { Bundle: 1 kb }\n"))).toContain(
      "questions[Q1].options[inline].metrics: give a list of {name, value, why}",
    );
  });

  it("renders each metric as a chip with its value and why", () => {
    const html = renderPage(parse(APPROACHES).page);
    expect(html).toContain('<li class="chip"><span class="mk">Testability</span> <b>medium</b> <span class="mw">needs the component mounted</span></li>');
    expect(html).toContain('<li class="chip"><span class="mk">Bundle</span> <b>+0 kb</b></li>');
  });
});

describe("how a question or a section chooses its layout", () => {
  it("defaults a question to cards and a section to text, and the before-after section to before-after", () => {
    expect(parse(APPROACHES.replace("    layout: approaches\n", "")).page.questions[0]?.layout).toBe("cards");
    const gate = parse("layout: gate\ntitle: G\nsections:\n  - { id: scope, title: Scope, body: x }\n  - { id: before-after, title: B, before: [a], after: [b] }\n").page;
    expect(gate.sections.map((s) => s.layout)).toEqual(["before-after", "text"]);
  });

  it("refuses an unknown layout on a question or a section, naming the field", () => {
    expect(problemsOf(APPROACHES.replace("layout: approaches", "layout: grid"))).toContain('questions[Q1].layout: "grid" is not one of cards, approaches');
    expect(problemsOf("layout: gate\ntitle: G\nsections:\n  - { id: s, title: S, body: x, layout: grid }\n")).toContain('sections[s].layout: "grid" is not one of text, before-after, plan, walkthrough');
  });

  it("tells a page-level approaches where it belongs", () => {
    expect(problemsOf(APPROACHES.replace("layout: questions", "layout: approaches"))[0]).toBe(
      'layout: "approaches" is how a question is drawn, not a page: keep the page\'s layout (questions, picks, gate) and set `layout: approaches` on the question',
    );
    expect(problemsOf("layout: plan\ntitle: G\n")[0]).toMatch(/^layout: "plan" is how a gate section is drawn, not a page/);
  });
});

describe("the approaches layout (example 01)", () => {
  it("asks each approach for its code shape", () => {
    expect(problemsOf(APPROACHES.replace('        view: { kind: tree, text: "src/\\n  hooks/useDebounce.ts" }\n', ""))).toContain(
      "questions[Q1].options[hook]: an approach shows its code shape: give `view` or `html`",
    );
  });

  it("needs options", () => {
    expect(problemsOf("layout: questions\ntitle: T\nquestions:\n  - { id: Q1, title: Open, layout: approaches }\n")).toContain("questions[Q1].layout: approaches compares options; this question has none");
  });

  it("draws one numbered approach per row with its View, a pro and con table and the metrics", () => {
    const html = renderPage(parse(APPROACHES).page);
    expect(html).toContain('<div class="opts approaches">');
    expect(html).toMatch(/<article class="opt approach"[^>]*>.*?<span class="num">01<\/span><span class="name">Inline effect<\/span>/s);
    expect(html).toContain('<div class="tradeoffs"><div class="row head"><span>Pro</span><span>Con</span></div><div class="row"><span class="pro">Nothing new to learn</span><span class="con">Duplicated wherever search exists</span></div><div class="row"><span class="pro">No dependency</span><span class="con"></span></div></div>');
    expect(html).toContain('data-kind="pseudocode"');
  });
});

describe("option rendering is valid HTML (T10 review note)", () => {
  it("keeps the View, the mock and the facts outside the label and ties them to the option", () => {
    for (const src of [APPROACHES, APPROACHES.replace("    layout: approaches\n", "")]) {
      const html = renderPage(parse(src).page);
      const labels = [...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)].map((m) => m[1] ?? "");
      for (const inner of labels) expect(inner).not.toMatch(/<(figure|pre|div|ul|dl|article|section|header)\b/);
      expect(html).toContain('aria-describedby="d-Q1-inline"');
      expect(html).toMatch(/<div class="od" id="d-Q1-inline">[\s\S]*?<figure class="view" data-kind="pseudocode">/);
    }
  });

  it("still lets the copied answer read the chosen option", () => {
    const html = renderPage(parse(APPROACHES).page);
    expect(html).toContain('<input type="radio" name="q-Q1" id="q-Q1-hook" value="hook" checked aria-describedby="d-Q1-hook">');
  });
});

const GATE = `layout: gate
title: Approve
sections:
  - id: before-after
    title: Before / After
    before: [A patient phones and waits]
    after: [A patient picks a slot online]
  - id: plan-shape
    title: Plan
    layout: plan
    figures: { Tasks: "12", Waves: "4", Effort: about 2 weeks }
    steps:
      - { when: Wave 1, title: Schema and API, detail: Two tables., tags: [T01, T02] }
      - { when: Wave 2, title: Booking screen, tags: [T03] }
  - id: path
    title: How a booking flows
    layout: walkthrough
    steps:
      - { at: app/book/page.tsx, title: The form posts, detail: The slot id goes to the API. }
      - at: app/api/bookings/route.ts:12
        title: The route checks the slot
        hot: true
        view: { kind: pseudocode, text: "if slot taken: 409" }
`;

describe("the before-after layout (example 17)", () => {
  it("draws two columns, before and after", () => {
    const html = renderPage(parse(GATE).page);
    expect(html).toContain('<div class="ba"><div class="panel before"><div class="k">Before</div><ul><li>A patient phones and waits</li></ul></div><div class="panel after"><div class="k">After</div><ul><li>A patient picks a slot online</li></ul></div></div>');
  });

  it("splits the section the CLI builds from analysis.md into the two columns", () => {
    const analysis = "# A\n\n## Summary\n\n## Before / After\n\n### Before\n\n- Phone and wait.\n\n### After\n\n- Pick online.\n";
    const s = beforeAfterSection(analysis);
    expect(s).not.toBeNull();
    if (!s) return;
    const { page } = parsePage("gate", "layout: gate\ntitle: G\nsections:\n  - { id: scope, title: Scope, body: x }\n", [], [s]);
    const html = renderPage(page);
    expect(html).toMatch(/<div class="panel before"><div class="k">Before<\/div><ul><li>[^<]+<\/li>/);
    expect(html).toMatch(/<div class="panel after"><div class="k">After<\/div><ul><li>[^<]+<\/li>/);
    expect(html).not.toContain("<b>Before</b>:");
  });

  it("labels the columns in the page's language", () => {
    const html = renderPage(parse(GATE.replace("title: Approve", "title: Approve\nlang: vi")).page);
    expect(html).toContain('<div class="k">Trước</div>');
    expect(html).toContain('<div class="k">Sau</div>');
  });

  it("keeps a hand-written before-after section with only a body readable", () => {
    const { page, problems } = parse("layout: gate\ntitle: G\nsections:\n  - { id: before-after, title: B, body: Written by hand. }\n");
    expect(problems).toEqual([]);
    expect(renderPage(page)).toContain("Written by hand.");
  });

  it("refuses an explicit before-after layout without both columns, and columns on another layout", () => {
    expect(problemsOf("layout: gate\ntitle: G\nsections:\n  - { id: s, title: S, layout: before-after, before: [a] }\n")).toContain("sections[s]: before-after needs `before` and `after` lines");
    expect(problemsOf("layout: gate\ntitle: G\nsections:\n  - { id: s, title: S, before: [a], after: [b] }\n")).toContain("sections[s]: before and after are drawn by `layout: before-after`");
  });
});

describe("the plan layout (example 16)", () => {
  it("draws the figures as cells and the steps as a timeline", () => {
    const html = renderPage(parse(GATE).page);
    expect(html).toContain('<div class="figs"><div class="fig"><div class="k">Tasks</div><div class="v">12</div></div>');
    expect(html).toMatch(/<ol class="steps plan"><li class="step"><div class="when">Wave 1<\/div><div class="dot"><\/div><div class="sb"><h3>Schema and API<\/h3><p>Two tables\.<\/p><div class="tags"><span class="tag">T01<\/span><span class="tag">T02<\/span><\/div>/);
  });

  it("refuses a plan without steps, a step without a title and more than 4 figures", () => {
    expect(problemsOf("layout: gate\ntitle: G\nsections:\n  - { id: s, title: S, layout: plan, body: x }\n")).toContain("sections[s]: layout plan needs `steps`");
    expect(problemsOf("layout: gate\ntitle: G\nsections:\n  - { id: s, title: S, layout: plan, steps: [{ when: W1 }] }\n")).toContain("sections[s].steps[1]: title is missing");
    expect(problemsOf("layout: gate\ntitle: G\nsections:\n  - { id: s, title: S, layout: plan, figures: { a: '1', b: '2', c: '3', d: '4', e: '5' }, steps: [{ title: x }] }\n")).toContain(
      "sections[s].figures: 5 figures; give at most 4",
    );
    expect(problemsOf("layout: gate\ntitle: G\nsections:\n  - { id: s, title: S, body: x, steps: [{ title: x }] }\n")).toContain("sections[s]: steps are drawn by `layout: plan` or `layout: walkthrough`");
  });
});

describe("the walkthrough layout (example 04)", () => {
  it("draws numbered steps with where they are in the code, the hot one marked and its View open", () => {
    const html = renderPage(parse(GATE).page);
    expect(html).toMatch(/<ol class="steps walk"><li class="step"><span class="num">1<\/span><div class="sb"><div class="loc">app\/book\/page\.tsx<\/div><h3>The form posts<\/h3>/);
    expect(html).toMatch(/<li class="step hot"><span class="num">2<\/span>[\s\S]*?<details class="snip" open><summary>pseudocode<\/summary><figure class="view" data-kind="pseudocode">/);
  });

  it("asks each step where it is in the code", () => {
    expect(problemsOf("layout: gate\ntitle: G\nsections:\n  - { id: s, title: S, layout: walkthrough, steps: [{ title: a }, { title: b, at: x.ts }] }\n")).toContain("sections[s].steps[1]: at is missing; say where in the code (path or path:line)");
  });
});

describe("the layouts stay static", () => {
  it("adds no script and no network address to the page", () => {
    const html = renderPage(parse(GATE).page) + renderPage(parse(APPROACHES).page);
    expect(html.match(/<script>/g)?.length).toBe(2);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("renders the gate end to end through the CLI", () => {
    const root = tempProject();
    cli(root, ["init"]);
    write(root, ".aidw/run/pages/gate.yaml", GATE);
    const r = cli(root, ["page", "render", "gate"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(readFileSync(join(root, ".aidw/run/pages/gate.html"), "utf8")).toContain('<ol class="steps walk">');
  });
});

describe("the page docs (library/decision-pages.md)", () => {
  const doc = readFileSync(join(__dirname, "../plugins/aidw/library/decision-pages.md"), "utf8");
  const blocks = [...doc.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
  const indent = (s: string, n: number) => s.replace(/^(?=.)/gm, " ".repeat(n));

  it("names every layout with its example and the metrics rule", () => {
    for (const x of ["`approaches` | 01", "`walkthrough` | 04", "`plan` | 16", "`before-after` | 17", "at most 4"]) expect(doc).toContain(x);
  });

  it("gives examples the CLI accepts", () => {
    const q = blocks.find((b) => b.includes("layout: approaches"));
    const s = blocks.find((b) => b.includes("layout: walkthrough"));
    // The doc shows one option; a choice needs a second one beside it.
    const question = `layout: questions\ntitle: T\nquestions:\n${indent(q ?? "", 2)}`.replace(
      "    options:\n",
      "    options:\n      - { key: inline, name: Inline, summary: x, view: { kind: tree, text: a }, metrics: [{ name: Bundle, value: +0 kb }, { name: Testability, value: low, why: none yet }] }\n",
    );
    expect(parsePage("q", question).problems).toEqual([]);
    expect(parsePage("g", `layout: gate\ntitle: G\n${s ?? ""}`).problems).toEqual([]);
  });
});
