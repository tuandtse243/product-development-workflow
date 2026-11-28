import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { parsePage, renderPage } from "../src/page.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, tempProject, write } from "./fixtures.js";

// Test-agent gaps for T11 (D4, M5, Q8b): hostile text in every new field, static output across all four layouts,
// vi labels, the CLI-built gate page with T9's Before / After, and refusals through `aidw page render`.

const H = `<script>alert(1)</script><img src=x onerror=y>" onmouseover="z`;
const H_ESC = "&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=y&gt;&quot; onmouseover=&quot;z";

/** No markup from the hostile text survives: one script (the page's own), no injected tag or attribute. */
function expectInert(html: string): void {
  expect(html.match(/<script\b/g)?.length).toBe(1);
  expect(html).not.toContain("<img");
  expect(html).not.toMatch(/"\s*onmouseover=/);
  expect(html).not.toMatch(/https?:\/\//);
  expect(html).not.toMatch(/<(link|iframe|object|embed)\b/);
}

const approaches = (lang?: string, multi = false) =>
  YAML.stringify({
    layout: "questions",
    title: "T",
    ...(lang ? { lang } : {}),
    questions: [
      {
        id: "Q1",
        title: H,
        layout: "approaches",
        recommend: "a",
        why: H,
        ...(multi ? { multi: true } : {}),
        options: ["a", "b"].map((key) => ({
          key,
          name: `${key} ${H}`,
          summary: H,
          pros: [H],
          cons: [H],
          view: { kind: "pseudocode", text: H },
          metrics: [
            { name: `Speed ${H}`, value: `120 ms ${H}`, why: H },
            { name: "Risk", value: "High", why: H },
          ],
        })),
      },
    ],
  });

const hostileGate = YAML.stringify({
  layout: "gate",
  title: "G",
  sections: [
    { id: "before-after", title: H, before: [H], after: [H], points: [`**Before**: ${H}`, `**After**: ${H}`, H] },
    { id: "plan-shape", title: "Plan", layout: "plan", figures: { [H]: H, Tasks: "12" }, steps: [{ when: H, title: H, detail: H, tags: [H], view: { kind: "tree", text: H } }] },
    { id: "walk", title: "Walk", layout: "walkthrough", steps: [{ at: H, title: H, detail: H, hot: true, view: { kind: "diff", text: `+${H}\n-${H}` } }] },
    { id: "text", title: "Text", body: H },
  ],
});

describe("hostile text in every new field is escaped (Q8b, D4, M5)", () => {
  it("approaches: option name, summary, pros, cons, view and metric name, value and why", () => {
    const { page, problems } = parsePage("q", approaches());
    expect(problems).toEqual([]);
    const html = renderPage(page);
    expectInert(html);
    expect(html).toContain(`<span class="mk">Speed ${H_ESC}</span> <b>120 ms ${H_ESC}</b> <span class="mw">${H_ESC}</span>`);
    expect(html).toContain(`<span class="pro">${H_ESC}</span><span class="con">${H_ESC}</span>`);
  });

  it("before-after, plan and walkthrough: columns, points, figures, step at, when, title, detail, tags and views", () => {
    const { page, problems } = parsePage("g", hostileGate);
    expect(problems).toEqual([]);
    const html = renderPage(page);
    expectInert(html);
    // Before / After: explicit lines and **Before**: points land in the columns, escaped.
    expect(html).toMatch(new RegExp(`<div class="panel before"><div class="k">Before</div><ul><li>${escRe(H_ESC)}</li><li>${escRe(H_ESC)}</li></ul>`));
    expect(html).toMatch(new RegExp(`<div class="panel after"><div class="k">After</div><ul><li>${escRe(H_ESC)}</li><li>${escRe(H_ESC)}</li></ul>`));
    // Plan figure key and value.
    expect(html).toContain(`<div class="fig"><div class="k">${H_ESC}</div><div class="v">${H_ESC}</div></div>`);
    expect(html).toContain(`<div class="when">${H_ESC}</div>`);
    expect(html).toContain(`<span class="tag">${H_ESC}</span>`);
    // Walkthrough location.
    expect(html).toContain(`<div class="loc">${H_ESC}</div>`);
  });
});

describe("the four layouts stay static (Q8b)", () => {
  it("no script beyond the page's own and no network address in any layout, vi included", () => {
    for (const src of [approaches(), approaches("vi", true), hostileGate, hostileGate.replace("title: G", "title: G\nlang: vi")]) {
      const html = renderPage(parsePage("p", src).page);
      expectInert(html);
    }
  });
});

describe("vi labels and option details (Q8b, D4)", () => {
  it("labels the pro and con table in Vietnamese", () => {
    const html = renderPage(parsePage("q", approaches("vi")).page);
    expect(html).toContain('<div class="row head"><span>Được</span><span>Mất</span></div>');
    expect(html).not.toContain("<span>Pro</span>");
  });

  it("an approaches question that allows several picks uses checkboxes", () => {
    const html = renderPage(parsePage("q", approaches(undefined, true)).page);
    expect(html).toMatch(/<input type="checkbox" name="q-Q1" id="q-Q1:a" value="a"/);
  });

  it("normalises a level to lower case and shows the metrics on a cards question too", () => {
    const obj = YAML.parse(approaches());
    delete obj.questions[0].layout;
    const { page, problems } = parsePage("q", YAML.stringify(obj));
    expect(problems).toEqual([]);
    expect(page.questions[0]?.layout).toBe("cards");
    expect(page.questions[0]?.options[0]?.metrics[1]?.value).toBe("high");
    expect(renderPage(page)).toContain('<ul class="chips">');
  });

  it("accepts figures with a percent or currency unit, and a figure needs no why", () => {
    for (const value of ["50%", "~20 USD", "+0.2 kb", "3 €"]) {
      const src = approaches().replaceAll(/value: 120 ms .*$/gm, `value: "${value}"`);
      expect(parsePage("q", src).problems).toEqual([]);
    }
  });

  it("flags a metric only one option names, on the option that lacks it", () => {
    const obj = YAML.parse(approaches());
    obj.questions[0].options[1].metrics.push({ name: "Cost", value: "low", why: "x" });
    const p = parsePage("q", YAML.stringify(obj)).problems;
    expect(p).toContain('questions[Q1].options[a].metrics: no "Cost"; every option names the same metrics so they line up');
    expect(p.join("\n")).not.toMatch(/options\[b\]\.metrics: no/);
  });

  it("an approach with html but no view still shows its code shape", () => {
    const obj = YAML.parse(approaches());
    for (const o of obj.questions[0].options) {
      delete o.view;
      o.html = "<pre>shape</pre>";
    }
    expect(parsePage("q", YAML.stringify(obj)).problems).toEqual([]);
  });

  it("a walkthrough step that is not hot keeps its View folded", () => {
    const src = "layout: gate\ntitle: G\nsections:\n  - id: w\n    title: W\n    layout: walkthrough\n    steps:\n      - { at: a.ts, title: A, view: { kind: pseudocode, text: x } }\n";
    const { page, problems } = parsePage("g", src);
    expect(problems).toEqual([]);
    const html = renderPage(page);
    expect(html).toContain('<details class="snip"><summary>');
    expect(html).not.toContain('<details class="snip" open>');
  });

  it("refuses figures outside a plan", () => {
    expect(parsePage("g", "layout: gate\ntitle: G\nsections:\n  - { id: s, title: S, body: x, figures: { a: '1' } }\n").problems).toContain("sections[s]: figures are drawn by `layout: plan`");
  });
});

const ID = "booking-v2";
let root: string;
function cli(...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}
const gateHtml = () => readFileSync(join(root, ".aidw/run/pages/gate.html"), "utf8");

describe("the gate page the CLI builds keeps T9's Before / After first, as two columns (D1, Q8b)", () => {
  beforeEach(() => {
    root = tempProject();
    cli("init");
    write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
    cli("change", "new", ID);
    write(root, `.aidw/changes/${ID}/analysis.md`, ANALYSIS_MD);
    write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
    write(root, `.aidw/changes/${ID}/tasks.yaml`, TASKS_YAML);
    write(root, `.aidw/changes/${ID}/quality.yaml`, QUALITY_YAML);
    write(root, `.aidw/changes/${ID}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  });

  const GATE = `layout: gate\ntitle: Approve\nchange: ${ID}\nsections:\n  - id: scope\n    title: Scope\n    body: Booking.\n  - id: plan-shape\n    title: Plan shape\n    layout: plan\n    figures: { Tasks: "3" }\n    steps:\n      - { when: Wave 1, title: Schema }\n  - id: walk\n    title: Walk\n    layout: walkthrough\n    steps:\n      - { at: app/page.tsx, title: Form }\n`;

  it("renders, puts before-after first and draws the analysis lines in the two columns", () => {
    write(root, ".aidw/run/pages/gate.yaml", GATE);
    const r = cli("page", "render", "gate");
    expect(r.code, r.err).toBe(0);
    const html = gateHtml();
    const first = html.indexOf('data-sec="');
    expect(html.slice(first, first + 30)).toContain('data-sec="before-after"');
    expect(html).toMatch(/<div class="panel before"><div class="k">Before<\/div><ul><li>A patient phones the clinic and waits on hold to book\.<\/li>/);
    expect(html).toMatch(/<div class="panel after"><div class="k">After<\/div><ul><li>A patient picks a free slot on their phone\.<\/li>/);
    expect(html).not.toContain("<b>Before</b>:");
    expect(html).toContain('<ol class="steps plan">');
    expect(html).toContain('<ol class="steps walk">');
    expectInert(html); // static, no network
  });

  it("escapes hostile Before / After lines read from analysis.md", () => {
    write(root, `.aidw/changes/${ID}/analysis.md`, ANALYSIS_MD.replace("- A patient phones the clinic and waits on hold to book.", `- ${H}`));
    write(root, ".aidw/run/pages/gate.yaml", GATE);
    const r = cli("page", "render", "gate");
    expect(r.code, r.err).toBe(0);
    const html = gateHtml();
    expectInert(html);
    expect(html).toContain(`<li>${H_ESC}</li>`);
  });

  it("labels the CLI-built columns in Vietnamese on a vi page", () => {
    write(root, ".aidw/run/pages/gate.yaml", GATE.replace("title: Approve", "title: Approve\nlang: vi"));
    expect(cli("page", "render", "gate").code).toBe(0);
    expect(gateHtml()).toContain('<div class="panel before"><div class="k">Trước</div>');
  });
});

describe("refusals through `aidw page render` (Q8b, D4, M5)", () => {
  beforeEach(() => {
    root = tempProject();
    cli("init");
  });

  const refused = (yaml: string, message: string) => {
    write(root, ".aidw/run/pages/p.yaml", yaml);
    const r = cli("page", "render", "p");
    expect(r.code).not.toBe(0);
    expect(r.err).toContain(message);
    expect(existsSync(join(root, ".aidw/run/pages/p.html"))).toBe(false);
  };

  it("refuses more than 4 metrics", () => {
    const obj = YAML.parse(approaches());
    for (const o of obj.questions[0].options) o.metrics.push(...["A", "B", "C"].map((name) => ({ name, value: "1 ms" })));
    refused(YAML.stringify(obj), "questions[Q1].options[a].metrics: 5 metrics; give at most 4, the ones that really differ");
  });

  it("refuses a level without why", () => {
    refused(approaches().replace(/(name: Risk\n\s+value: High\n)\s+why: .*\n/g, "$1"), '"high" is a level: say why in `why`');
  });

  it("refuses an approach without its code shape", () => {
    const obj = YAML.parse(approaches());
    delete obj.questions[0].options[0].view;
    refused(YAML.stringify(obj), "questions[Q1].options[a]: an approach shows its code shape: give `view` or `html`");
  });

  it("refuses a section layout given to the page", () => {
    refused("layout: walkthrough\ntitle: G\n", 'layout: "walkthrough" is how a gate section is drawn, not a page');
  });

  it("refuses a plan without steps and a walkthrough step without at", () => {
    refused("layout: gate\ntitle: G\nsections:\n  - { id: s, title: S, layout: plan, body: x }\n", "sections[s]: layout plan needs `steps`");
    refused("layout: gate\ntitle: G\nsections:\n  - { id: s, title: S, layout: walkthrough, steps: [{ title: a }] }\n", "sections[s].steps[1]: at is missing");
  });

  it("refuses an explicit before-after without both columns", () => {
    refused("layout: gate\ntitle: G\nsections:\n  - { id: s, title: S, layout: before-after, after: [b] }\n", "sections[s]: before-after needs `before` and `after` lines");
  });
});

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
