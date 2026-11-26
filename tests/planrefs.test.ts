/**
 * T13 of the rpi upgrades (I3, Q4, R8, M13, I11, M4, OP3): a task carries code to imitate (`patterns`), the Docs Briefs
 * it builds on (`docs`) and the checks only a human can make (`manual`). The brief inlines the first two, analyze refuses
 * what no longer holds, the gate's plan section lists all three, and delivery warns about a package no Docs Brief covers.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import { beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { pathsFor } from "../src/project.js";
import { manifestLibraries, parsePatternPath, patternBriefLines, planGateSection, programDesignLibraries, uncoveredPackages } from "../src/planrefs.js";
import { validateTasksText } from "../src/tasks.js";
import { checkDelivery } from "../src/deliver.js";
import { ANALYSIS_MD, MAIN_SPEC, PROGRAM_DESIGN_MD, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, planReviewed, tempProject, write } from "./fixtures.js";

const ID = "booking-refs";
const C = `.aidw/changes/${ID}`;
let root: string;

function cli(...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, errors: () => (JSON.parse(out).errors as { message: string }[]).map((e) => e.message), warnings: () => (JSON.parse(out).warnings as { message: string }[]).map((e) => e.message) };
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const BRIEF = (lib: string, version: string, topic: string, date = today()) =>
  `---\nlib: ${lib}\nversion: "${version}"\ntopic: ${topic}\ndate: ${date}\n---\n\n# ${lib} ${topic}\n\n## Question\nHow?\n\n## Answer\nUse safeParse at the edge; it never throws.\n\n## Evidence\n| # | Claim |\n|---|---|\n\n## Pitfalls\nz.coerce turns "" into 0.\n\n## Not found\nNone.\n`;

/** The fixture plan with fields added to T01 (a YAML fragment indented for a task). */
const tasksWith = (t01: string, t02 = "") =>
  TASKS_YAML.replace("    status: pending\n  - id: T02", `${t01}    status: pending\n  - id: T02`).replace(/(id: T02[\s\S]*?)(    status: pending\n)$/, `$1${t02}$2`);

const SOURCE = Array.from({ length: 50 }, (_, i) => `export const line${i + 1} = ${i + 1};`).join("\n") + "\n";

function setup() {
  root = tempProject();
  cli("init");
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  expect(cli("change", "new", ID, "--workflow", "feature").code).toBe(0);
  write(root, `${C}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `${C}/tasks.yaml`, TASKS_YAML);
  write(root, `${C}/quality.yaml`, QUALITY_YAML);
  write(root, `${C}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  write(root, "lib/store.ts", SOURCE);
}
beforeEach(setup);

const analyze = () => cli("analyze", ID, "--json");
const setTasks = (text: string) => writeFileSync(join(root, C, "tasks.yaml"), text);
const setProgramDesign = (text: string) => writeFileSync(join(root, C, "program-design.md"), text);
const withSignature = (code: string, lang = "ts") => PROGRAM_DESIGN_MD.replace(/## Signatures and contracts\n\n```ts\n/, `## Signatures and contracts\n\n\`\`\`${lang}\n${code}\n`);

describe("the tasks.yaml fields (schema)", () => {
  it("accepts patterns with a line range and a why, docs as <lib>@<version> <topic>, manual as lines", () => {
    const text = tasksWith('    patterns: [{ path: "lib/store.ts:1-20", why: the store shape }]\n    docs: ["zod@3.23.8 parsing"]\n    manual: ["the email reads well on a phone"]\n');
    expect(validateTasksText(text, "tasks.yaml").items).toEqual([]);
    expect(parsePatternPath("src/a.ts:10-40")).toEqual({ file: "src/a.ts", start: 10, end: 40 });
    expect(parsePatternPath("src/a.ts:7")).toEqual({ file: "src/a.ts", start: 7, end: 7 });
  });

  it("refuses a path without lines, outside the project or backwards, a pattern with no why, a bad docs entry and an empty check", () => {
    const text = tasksWith(
      '    patterns: [{ path: "lib/store.ts", why: x }, { path: "../a.ts:1-2", why: x }, { path: "a.ts:9-3", why: x }, { path: "a.ts:1-2" }]\n    docs: ["zod parsing"]\n    manual: [""]\n',
    );
    const msgs = validateTasksText(text, "tasks.yaml").errors.map((e) => e.message);
    expect(msgs.filter((m) => /patterns\[\d\]: path/.test(m))).toHaveLength(3);
    expect(msgs).toContain('task T01: patterns[4] needs a "why": what the implementer should imitate there');
    expect(msgs.some((m) => m.startsWith("task T01: docs:") && /<lib>@<version> <topic>/.test(m))).toBe(true);
    expect(msgs).toContain('task T01: "manual" must be a list of checks a human makes, each a non-empty line');
    const twoLines = validateTasksText(tasksWith('    patterns: [{ path: "lib/store.ts:1-2", why: "first\\nsecond" }]\n'), "tasks.yaml").errors.map((e) => e.message);
    expect(twoLines).toContain('task T01: patterns[1]: "why" must be one line (it heads the snippet in the brief)');
  });
});

describe("aidw analyze: patterns (I3, Q4)", () => {
  it("passes a pattern whose file and lines exist", () => {
    setTasks(tasksWith('    patterns: [{ path: "lib/store.ts:10-30", why: the store shape }]\n'));
    const r = analyze();
    expect(r.code, r.out).toBe(0);
  });

  it("refuses a pattern whose file or lines no longer exist", () => {
    setTasks(tasksWith('    patterns: [{ path: "lib/gone.ts:1-5", why: a }, { path: "lib/store.ts:40-60", why: b }]\n'));
    const r = analyze();
    expect(r.code).toBe(1);
    expect(r.errors()).toContain('task T01: pattern "lib/gone.ts:1-5" names lib/gone.ts, which does not exist: point at code that is there today');
    expect(r.errors()).toContain('task T01: pattern "lib/store.ts:40-60" ends at line 60, but lib/store.ts has 50 lines: point at lines that exist');
  });

  it("warns about a pattern longer than 40 lines and more than 3 patterns", () => {
    const p = (r: string) => `{ path: "lib/store.ts:${r}", why: x }`;
    setTasks(tasksWith(`    patterns: [${p("1-45")}, ${p("1-2")}, ${p("3-4")}, ${p("5-6")}]\n`));
    const r = analyze();
    expect(r.code, r.out).toBe(0);
    expect(r.warnings()).toContain("task T01 names 4 patterns; the brief shows the first 3: keep the ones that teach the most");
    expect(r.warnings().some((w) => /"lib\/store.ts:1-45" spans 45 lines/.test(w))).toBe(true);
  });

  it("does not judge a Change created before template 3", () => {
    const file = join(root, C, "change.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace(/^analysis_template: \d+\n/m, "analysis_template: 2\n"));
    setTasks(tasksWith('    patterns: [{ path: "lib/gone.ts:1-5", why: a }]\n    docs: ["zod@3.23.8 parsing"]\n'));
    expect(analyze().errors().filter((m) => /pattern|docs|Program Design uses/.test(m))).toEqual([]);
  });
});

describe("aidw analyze: Docs Briefs (R8, M13)", () => {
  it("refuses a docs entry with no fresh Docs Brief, and passes once Research wrote it", () => {
    setTasks(tasksWith('    docs: ["zod@3.23.8 parsing"]\n'));
    const missing = analyze();
    expect(missing.code).toBe(1);
    expect(missing.errors().some((m) => m.startsWith('task T01: docs "zod@3.23.8 parsing" has no fresh Docs Brief (missing') && m.includes(".aidw/research/docs/zod@3.23-parsing.md"))).toBe(true);
    write(root, ".aidw/research/docs/zod@3.23-parsing.md", BRIEF("zod", "3.23.8", "parsing", "2020-01-01"));
    expect(analyze().errors().some((m) => /has no fresh Docs Brief \(stale/.test(m))).toBe(true);
    write(root, ".aidw/research/docs/zod@3.23-parsing.md", BRIEF("zod", "3.23.8", "parsing"));
    const r = analyze();
    expect(r.code, r.out).toBe(0);
  });

  it("aidw docs-brief --change checks every docs entry of the plan", () => {
    setTasks(tasksWith('    docs: ["zod@3.23.8 parsing"]\n', '    docs: ["next@15.1.3 caching"]\n'));
    write(root, ".aidw/research/docs/zod@3.23-parsing.md", BRIEF("zod", "3.23.8", "parsing"));
    const r = cli("docs-brief", "--change", ID);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^FRESH .aidw\/research\/docs\/zod@3.23-parsing.md \(T01: zod@3.23.8 parsing\)/m);
    expect(r.out).toMatch(/^MISSING .aidw\/research\/docs\/next@15.1-caching.md \(T02: next@15.1.3 caching\)/m);
    expect(r.out).toMatch(/spawn aidw:research/i);
  });
});

describe("aidw analyze: libraries the Program Design names (OP3)", () => {
  it("reads the packages its code blocks import, not builtins, relative paths, aliases or the project's own folders", () => {
    write(root, "tsconfig.json", '{ "compilerOptions": { "paths": { "@app/*": ["src/*"] } } }');
    const text = withSignature(
      [
        'import { z } from "zod";',
        'import { readFile } from "node:fs";',
        'import path from "path";',
        'import { slots } from "./slots";',
        'import { db } from "@/db";',
        'import { cfg } from "@app/config";',
        'import { store } from "lib/store";',
        'import { Button } from "@radix-ui/react-slot/dist";',
        'const dayjs = require("dayjs");',
      ].join("\n"),
    );
    expect(programDesignLibraries(text, root).map((l) => l.name).sort()).toEqual(["@radix-ui/react-slot", "dayjs", "zod"]);
    const py = withSignature("import os, yaml\nfrom fastapi import APIRouter\nfrom app.models import Slot\nfrom . import x", "python");
    write(root, "app/models.py", "");
    expect(programDesignLibraries(py, root).map((l) => `${l.name}<${l.imported}`).sort()).toEqual(["fastapi<fastapi", "pyyaml<yaml"]);
    const go = withSignature('import (\n\t"fmt"\n\t"github.com/go-chi/chi/v5/middleware"\n)', "go");
    expect(programDesignLibraries(go, root).map((l) => l.name)).toEqual(["github.com/go-chi/chi"]);
    const diff = PROGRAM_DESIGN_MD.replace(/```ts\n/, '```diff\n--- a/app/x.ts\n+++ b/app/x.ts\n-import old from "left-pad";\n+import { z } from "zod";\n');
    expect(programDesignLibraries(diff, root).map((l) => l.name)).toEqual(["zod"]);
  });

  it("refuses a library absent from the manifests that no task's docs names", () => {
    setProgramDesign(withSignature('import { z } from "zod";'));
    const r = analyze();
    expect(r.code).toBe(1);
    expect(r.errors().some((m) => m.startsWith('the Program Design uses zod ("zod") and the project has no manifest yet: add "docs: [zod@<version> <topic>]"'))).toBe(true);
  });

  it("passes when a manifest lists it, or a task's docs names it", () => {
    setProgramDesign(withSignature('import { z } from "zod";'));
    write(root, "package.json", JSON.stringify({ name: "app", dependencies: { zod: "^3.23.8" } }));
    expect(analyze().code).toBe(0);
    write(root, "package.json", JSON.stringify({ name: "app", dependencies: {} }));
    expect(analyze().errors().some((m) => /no manifest of the project lists it \(package\.json\)/.test(m))).toBe(true);
    setTasks(tasksWith('    docs: ["zod@3.23.8 parsing"]\n'));
    write(root, ".aidw/research/docs/zod@3.23-parsing.md", BRIEF("zod", "3.23.8", "parsing"));
    const r = analyze();
    expect(r.code, r.out).toBe(0);
  });

  it("a Go module is named in docs by its short name (a Docs Brief file cannot hold a module path)", () => {
    setProgramDesign(withSignature('import "github.com/go-chi/chi/v5"', "go"));
    expect(analyze().errors().some((m) => m.includes('add "docs: [chi@<version> <topic>]"'))).toBe(true);
    setTasks(tasksWith('    docs: ["chi@5.0.12 routing"]\n'));
    write(root, ".aidw/research/docs/chi@5.0-routing.md", BRIEF("chi", "5.0.12", "routing"));
    const r = analyze();
    expect(r.code, r.out).toBe(0);
  });

  it("reads Python and Go manifests", () => {
    write(root, "pyproject.toml", '[project]\nname = "svc"\ndependencies = [\n  "fastapi>=0.110",\n  "PyYAML==6.0.1",\n]\n\n[tool.poetry.dependencies]\npython = "^3.12"\nhttpx = "^0.27"\n');
    write(root, "go.mod", "module example.com/svc\n\ngo 1.22\n\nrequire (\n\tgithub.com/go-chi/chi/v5 v5.0.12\n)\n");
    const m = manifestLibraries(root);
    expect([...m.pypi].sort()).toEqual(["fastapi", "httpx", "pyyaml", "svc"]);
    expect(m.go).toEqual(["example.com/svc", "github.com/go-chi/chi/v5"]);
    setProgramDesign(withSignature('import (\n\t"github.com/go-chi/chi/v5/middleware"\n\t"example.com/svc/internal/slots"\n)', "go"));
    expect(analyze().code).toBe(0);
  });
});

describe("aidw brief inlines patterns and Docs Briefs", () => {
  it("shows up to 3 snippets of at most 40 lines, and the Answer and Pitfalls of each brief", () => {
    const p = (r: string) => `{ path: "lib/store.ts:${r}", why: shape ${r} }`;
    setTasks(tasksWith(`    patterns: [${p("1-45")}, ${p("2-3")}, ${p("4-4")}, ${p("5-5")}]\n    docs: ["zod@3.23.8 parsing"]\n`));
    write(root, ".aidw/research/docs/zod@3.23-parsing.md", BRIEF("zod", "3.23.8", "parsing"));
    planReviewed(root, ID);
    for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli("transition", ID, s).code).toBe(0);
    expect(cli("approve", ID).code).toBe(0);
    expect(cli("transition", ID, "executing").code).toBe(0);
    const brief = readFileSync(cli("brief", "T01").out.trim(), "utf8");
    expect(brief).toMatch(/## Patterns to follow/);
    expect(brief).toMatch(/### `lib\/store\.ts:1-45`: shape 1-45\n\n```ts\nexport const line1 = 1;/);
    expect(brief).toMatch(/export const line40 = 40;\n```\n\(lines 41-45 cut: read them in the file\)/);
    expect(brief).not.toMatch(/line41 = 41/);
    expect(brief).toMatch(/### `lib\/store\.ts:4-4`/);
    expect(brief).not.toMatch(/### `lib\/store\.ts:5-5`/);
    expect(brief).toMatch(/\(1 more pattern\(s\) in tasks\.yaml\)/);
    expect(brief).toMatch(/## Docs Briefs/);
    expect(brief).toMatch(/### zod@3\.23\.8 parsing \(`\.aidw\/research\/docs\/zod@3\.23-parsing\.md`, fresh\)/);
    expect(brief).toMatch(/\*\*Answer\*\*\n\nUse safeParse at the edge; it never throws\./);
    expect(brief).toMatch(/\*\*Pitfalls\*\*\n\nz\.coerce turns "" into 0\./);
    expect(brief).not.toMatch(/## Evidence/);
    // the reviewer judges against the same patterns and briefs
    expect(readFileSync(cli("brief", "T01", "--for", "review").out.trim(), "utf8")).toMatch(/## Patterns to follow[\s\S]*## Docs Briefs/);
  });

  it("says so when the lines are gone", () => {
    const lines = patternBriefLines(root, { id: "T01", patterns: [{ path: "lib/store.ts:49-80", why: "x" }] });
    expect(lines.join("\n")).toMatch(/lib\/store\.ts no longer has these lines/);
  });
});

describe("the gate's plan section (layout plan)", () => {
  it("lists each task's patterns, Docs Briefs (with links) and checks for the user", () => {
    setTasks(tasksWith('    patterns: [{ path: "lib/store.ts:1-20", why: the store shape }]\n    docs: ["zod@3.23.8 parsing"]\n    manual: ["the email reads well on a phone"]\n'));
    write(root, ".aidw/research/docs/zod@3.23-parsing.md", BRIEF("zod", "3.23.8", "parsing"));
    const tasks = (YAML.parse(readFileSync(join(root, C, "tasks.yaml"), "utf8")) as { tasks: Record<string, unknown>[] }).tasks as never;
    const s = planGateSection(pathsFor(root), tasks, join(root, ".aidw/run/pages"));
    expect(s.layout).toBe("plan");
    expect(s.figures).toEqual({ Tasks: "2", Stages: "2", "Widest stage": "1", "Checks for you": "1" });
    expect(s.steps?.map((x) => [x.title, x.when])).toEqual([["T01 Booking API", "stage 1"], ["T02 Booking page", "stage 2"]]);
    expect(s.steps?.[0]?.detail).toMatch(/Patterns: `lib\/store\.ts:1-20` \(the store shape\)/);
    expect(s.steps?.[0]?.detail).toMatch(/Docs: `zod@3\.23\.8 parsing` \(fresh\)/);
    expect(s.points).toContain("**T01**: the email reads well on a phone");
    expect(s.html).toMatch(/<a href="\.\.\/\.\.\/research\/docs\/zod@3\.23-parsing\.md">zod@3\.23\.8 parsing<\/a>/);
    // the page is opened as a file:// URL of .aidw/run/pages/gate.html: the link resolves to the brief
    const href = /<a href="([^"]+)"/.exec(s.html)?.[1] as string;
    expect(fileURLToPath(new URL(href, pathToFileURL(join(root, ".aidw/run/pages/gate.html"))))).toBe(join(root, ".aidw/research/docs/zod@3.23-parsing.md"));

    write(root, ".aidw/run/pages/gate.yaml", `layout: gate\ntitle: Approve\nchange: ${ID}\nsections:\n  - id: scope\n    title: Scope\n    body: Booking.\n`);
    const r = cli("page", "render", "gate");
    expect(r.code, r.err).toBe(0);
    const html = readFileSync(join(root, ".aidw/run/pages/gate.html"), "utf8");
    expect(html).toMatch(/data-sec="plan"/);
    expect(html).toMatch(/class="steps plan"/);
    expect(html).toMatch(/the email reads well on a phone/);
  });
});

describe("aidw deliver warns about a package no Docs Brief covers (OP3)", () => {
  it("names packages the Change added to a manifest since its first base commit", () => {
    write(root, "package.json", JSON.stringify({ name: "app", dependencies: { react: "18.3.1" } }));
    const g = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
    g("init", "-q");
    g("config", "user.email", "aidw@test");
    g("config", "user.name", "aidw test");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    const base = g("rev-parse", "HEAD");
    write(root, "package.json", JSON.stringify({ name: "app", dependencies: { react: "18.3.1", zod: "3.23.8", dayjs: "1.11.13" } }));
    write(root, ".aidw/research/docs/zod@3.23-parsing.md", BRIEF("zod", "3.23.8", "parsing"));
    const tasks = [{ id: "T01", base }, { id: "T02" }];
    expect(uncoveredPackages(pathsFor(root), tasks)).toEqual(["dayjs"]);
    expect(uncoveredPackages(pathsFor(root), [{ id: "T01", base, docs: ["dayjs@1.11.13 parsing"] }])).toEqual([]);
    expect(uncoveredPackages(pathsFor(root), [{ id: "T01" }])).toEqual([]);
  });
});

describe("the Technical Planner and the orchestrator say so", () => {
  const plugin = join(__dirname, "..", "plugins", "aidw");
  const read = (f: string) => readFileSync(join(plugin, f), "utf8");

  it("the planner reads the Program Design and writes patterns, docs and manual", () => {
    const role = read("roles/technical-planner/role.md");
    expect(role).toMatch(/^reads: \[[^\]]*\bprogram-design\b/m);
    for (const f of ["patterns:", "docs:", "manual:"]) expect(role).toContain(f);
    expect(role).toMatch(/Start from the Program Design/);
    expect(read("roles/technical-planner/skills/task-interfaces.md")).toMatch(/## The Program Design already holds the names/);
  });

  it("the start skill has Research write the Docs Briefs after the planner, before the plan review", () => {
    const skill = read("skills/start/SKILL.md");
    const step7 = skill.slice(skill.indexOf("## 7. Plan"), skill.indexOf("## 8."));
    expect(step7).toMatch(/aidw docs-brief --change <id>/);
    expect(step7).toMatch(/MISSING, STALE or INVALID, spawn one `aidw:research` Agent/);
    expect(step7).toMatch(/before the plan review/);
  });
});

// ------------------------------------------------------------------------------------- gaps found by the test agent

describe("pattern paths stay inside the project and inside the file (I3)", () => {
  it("refuses absolute paths, drive letters and any `..` segment, and lines 0 or reversed", () => {
    for (const bad of ["/etc/passwd:1-2", "C:/x.ts:1", "./../a.ts:1", "src/../../a.ts:1-2", "src/..:1", "a.ts:0", "a.ts:0-3", "a.ts:5-4", "a.ts:", "a.ts:1-", "a b.ts:1"]) {
      expect(parsePatternPath(bad), bad).toBeNull();
    }
    expect(parsePatternPath("./src/a.ts:3")).toEqual({ file: "src/a.ts", start: 3, end: 3 });
    const msgs = validateTasksText(tasksWith('    patterns: [{ path: "/etc/passwd:1-2", why: x }, { path: "src/../../a.ts:1-2", why: y }]\n'), "tasks.yaml").errors.map((e) => e.message);
    expect(msgs.filter((m) => /patterns\[\d\]: path/.test(m))).toHaveLength(2);
  });

  it("accepts the last line of the file and refuses the line after it, with or without a final newline or with CRLF", () => {
    setTasks(tasksWith('    patterns: [{ path: "lib/store.ts:50", why: a }, { path: "lib/store.ts:1-50", why: b }]\n'));
    expect(analyze().errors().filter((m) => /pattern/.test(m))).toEqual([]);
    setTasks(tasksWith('    patterns: [{ path: "lib/store.ts:51", why: a }]\n'));
    expect(analyze().errors()).toContain('task T01: pattern "lib/store.ts:51" ends at line 51, but lib/store.ts has 50 lines: point at lines that exist');
    write(root, "lib/nonl.ts", "a\nb\nc");
    write(root, "lib/crlf.ts", "a\r\nb\r\nc\r\n");
    setTasks(tasksWith('    patterns: [{ path: "lib/nonl.ts:1-3", why: a }, { path: "lib/crlf.ts:3", why: b }]\n'));
    expect(analyze().errors().filter((m) => /pattern/.test(m))).toEqual([]);
    setTasks(tasksWith('    patterns: [{ path: "lib/crlf.ts:4", why: b }]\n'));
    expect(analyze().errors().some((m) => /lib\/crlf\.ts has 3 lines/.test(m))).toBe(true);
  });

  it("refuses a pattern that names a folder", () => {
    setTasks(tasksWith('    patterns: [{ path: "lib:1", why: a }]\n'));
    expect(analyze().errors().some((m) => /pattern "lib:1" names lib, which does not exist/.test(m))).toBe(true);
  });
});

/** The fenced blocks of a Markdown text as CommonMark reads them: each opening fence and where it closes. */
function fenceSpans(md: string): { open: string; body: string[] }[] {
  const out: { open: string; body: string[] }[] = [];
  let cur: { open: string; len: number; ch: string; body: string[] } | null = null;
  for (const line of md.split("\n")) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!cur) {
      if (m && !(m[1]!.startsWith("`") && m[2]!.includes("`"))) cur = { open: line, len: m[1]!.length, ch: m[1]![0]!, body: [] };
    } else if (m && m[1]![0] === cur.ch && m[1]!.length >= cur.len && !m[2]!.trim()) {
      out.push({ open: cur.open, body: cur.body });
      cur = null;
    } else cur.body.push(line);
  }
  if (cur) out.push({ open: cur.open, body: cur.body });
  return out;
}

describe("aidw brief keeps a snippet with fences in one code block (Q4)", () => {
  const snippet = (file: string, text: string) => {
    write(root, file, text);
    const md = patternBriefLines(root, { id: "T01", patterns: [{ path: `${file}:1-${text.split("\n").length}`, why: "x" }] }).join("\n");
    return fenceSpans(md);
  };

  it("a snippet with a ``` line at the start is one block with every line inside", () => {
    const text = "const doc = `\n```ts\nlet a = 1;\n```\n`;";
    const spans = snippet("lib/doc.ts", text);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.body).toEqual(text.split("\n"));
  });

  it("a snippet with an indented ``` line (which closes a fence in CommonMark) is one block", () => {
    const text = "const doc = `\n  ```sh\n  npm test\n  ```\n`;";
    const spans = snippet("lib/indented.ts", text);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.body).toEqual(text.split("\n"));
  });

  it("a Markdown snippet that itself uses a ```` fence is one block", () => {
    const text = "# Doc\n\n````md\n```ts\nx\n```\n````\n";
    const spans = snippet("docs/guide.md", text.trimEnd());
    expect(spans).toHaveLength(1);
    expect(spans[0]!.body).toEqual(text.trimEnd().split("\n"));
  });
});

describe("the gate page escapes what the plan says (hostile text)", () => {
  it("renders pattern whys, docs entries and checks for the user as text, never as markup", () => {
    setTasks(
      tasksWith(
        '    patterns: [{ path: "lib/store.ts:1-2", why: "<img src=x onerror=alert(1)>" }]\n    docs: ["zod@3.23.8 <b>parsing</b>"]\n    manual: ["<script>alert(2)</script> & \\"quoted\\""]\n',
      ),
    );
    write(root, ".aidw/run/pages/gate.yaml", `layout: gate\ntitle: Approve\nchange: ${ID}\nsections:\n  - id: scope\n    title: Scope\n    body: Booking.\n`);
    const r = cli("page", "render", "gate");
    expect(r.code, r.err).toBe(0);
    const html = readFileSync(join(root, ".aidw/run/pages/gate.html"), "utf8");
    expect(html).toMatch(/data-sec="plan"/);
    expect(html).not.toMatch(/<img src=x/);
    expect(html).not.toMatch(/<script>alert\(2\)/);
    expect(html).not.toMatch(/<b>parsing<\/b>/);
    expect(html).toMatch(/&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
    expect(html).toMatch(/&lt;img src=x onerror=alert\(1\)&gt;/);
  });
});

describe("aidw analyze judges patterns, docs and libraries only before the gate, on template 3", () => {
  it("does not judge the Program Design's libraries for a Change of template 2", () => {
    const file = join(root, C, "change.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace(/^analysis_template: \d+\n/m, "analysis_template: 2\n"));
    setProgramDesign(withSignature('import { z } from "zod";'));
    expect(analyze().errors().filter((m) => /Program Design uses/.test(m))).toEqual([]);
  });

  it("after the gate a pattern whose file the build changed or removed is not refused", () => {
    setTasks(tasksWith('    patterns: [{ path: "lib/store.ts:10-30", why: the store shape }]\n'));
    planReviewed(root, ID);
    for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli("transition", ID, s).code).toBe(0);
    expect(cli("approve", ID).code).toBe(0);
    expect(cli("transition", ID, "executing").code).toBe(0);
    write(root, "lib/store.ts", "export const shorter = 1;\n");
    expect(analyze().errors().filter((m) => /pattern/.test(m))).toEqual([]);
    rmSync(join(root, "lib/store.ts"));
    expect(analyze().errors().filter((m) => /pattern/.test(m))).toEqual([]);
  });
});

describe("OP3: what is not a missing library", () => {
  const names = (code: string, lang = "ts") => programDesignLibraries(withSignature(code, lang), root).map((l) => l.name).sort();

  it("a scoped subpath is its package, a bare subpath is its package", () => {
    expect(names('import { a } from "@acme/kit/sub/deep";\nimport fp from "lodash/fp";\nimport { z } from "zod/v4";')).toEqual(["@acme/kit", "lodash", "zod"]);
  });

  it("type-only and relative imports: the package of a type import counts once, a relative one never", () => {
    expect(names('import type { Request } from "express";\nimport type { Slot } from "./types";\nimport { type X } from "../x";\nexport type { Y } from "./y";')).toEqual(["express"]);
    write(root, "package.json", JSON.stringify({ name: "app", dependencies: { express: "4.19.2", lodash: "4.17.21" } }));
    setProgramDesign(withSignature('import type { Request } from "express";\nimport fp from "lodash/fp";\nimport type { Slot } from "./types";'));
    expect(analyze().errors().filter((m) => /Program Design uses/.test(m))).toEqual([]);
  });

  it("a monorepo workspace package (listed by its own package.json) is not flagged, with or without a subpath", () => {
    write(root, "package.json", JSON.stringify({ name: "mono", private: true, workspaces: ["packages/*"] }));
    write(root, "packages/ui/package.json", JSON.stringify({ name: "@acme/ui", dependencies: { "class-variance-authority": "0.7.0" } }));
    write(root, "apps/web/app/package.json", JSON.stringify({ name: "web", dependencies: { next: "15.1.3" } }));
    setProgramDesign(withSignature('import { Button } from "@acme/ui/button";\nimport { cva } from "class-variance-authority";\nimport Link from "next/link";'));
    expect(analyze().errors().filter((m) => /Program Design uses/.test(m))).toEqual([]);
  });

  it("a Python src-layout package named in pyproject is not flagged under its import name", () => {
    write(root, "pyproject.toml", '[project]\nname = "my-app"\ndependencies = ["fastapi"]\n');
    setProgramDesign(withSignature("from my_app.slots import Slot\nfrom fastapi import APIRouter", "python"));
    expect(analyze().errors().filter((m) => /Program Design uses/.test(m))).toEqual([]);
  });

  it("reads only code blocks: sh, yaml and text quote names too, and are skipped", () => {
    expect(names('npm install "left-pad"\nimport x from "zod"', "sh")).toEqual([]);
    expect(names('from: "dayjs"', "yaml")).toEqual([]);
    expect(names('import { z } from "zod";', "")).toEqual(["zod"]);
  });

  it("reads the dependencies a package.json block or diff adds", () => {
    expect(names('{\n  "name": "app",\n  "version": "1.0.0",\n  "dependencies": {\n    "resend": "^4.0.1"\n  },\n  "engines": { "node": ">=20" }\n}', "json")).toEqual(["resend"]);
    const diff = '--- a/package.json\n+++ b/package.json\n@@\n   "dependencies": {\n-    "left-pad": "1.3.0",\n+    "@react-email/components": "0.0.25",\n     "next": "15.1.3"';
    expect(names(diff, "diff")).toEqual(["@react-email/components", "next"]);
    expect(names('{ "status": "1.0", "id": "2" }', "json")).toEqual([]);
  });

  it("an SQL block with a quoted table after a lower-case from is not an import", () => {
    expect(names('select * from "users" where id = $1;', "sql")).toEqual([]);
  });
});

describe("aidw deliver: the uncovered-package warning never fails delivery (OP3)", () => {
  const g = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
  const commitBase = () => {
    g("init", "-q");
    g("config", "user.email", "aidw@test");
    g("config", "user.name", "aidw test");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    return g("rev-parse", "HEAD");
  };

  it("is a warning of checkDelivery, not an error", () => {
    write(root, "package.json", JSON.stringify({ name: "app", dependencies: {} }));
    const base = commitBase();
    setTasks(TASKS_YAML.replace("    status: pending\n  - id: T02", `    base: ${base}\n    status: pending\n  - id: T02`));
    write(root, "package.json", JSON.stringify({ name: "app", dependencies: { dayjs: "1.11.13" } }));
    const d = checkDelivery(pathsFor(root), ID);
    expect(d.warnings.map((x) => x.message).some((m) => /added the package dayjs, which no Docs Brief covers/.test(m))).toBe(true);
    expect(d.errors.map((x) => x.message).some((m) => /dayjs/.test(m))).toBe(false);
    expect(d.warnings.map((x) => x.message).some((m) => /have Research write its Docs Brief[^\n]*aidw docs-brief dayjs@<installed version> <topic>/.test(m))).toBe(true);
  });

  it("reads the modules a go.mod and the dependencies a pyproject.toml gained (no uv.lock)", () => {
    write(root, "go.mod", "module example.com/svc\n\ngo 1.22\n\nrequire (\n\tgithub.com/go-chi/chi/v5 v5.0.12\n)\n");
    write(root, "pyproject.toml", '[project]\nname = "svc"\ndependencies = [\n  "fastapi>=0.110",\n]\n');
    const base = commitBase();
    write(root, "go.mod", "module example.com/svc\n\ngo 1.22\n\nrequire (\n\tgithub.com/go-chi/chi/v5 v5.0.12\n\tgithub.com/redis/go-redis/v9 v9.5.1\n)\n");
    write(root, "pyproject.toml", '[project]\nname = "svc"\ndependencies = [\n  "fastapi>=0.110",\n  "httpx>=0.27",\n]\n\n[tool.poetry.dependencies]\npython = "^3.12"\nPyYAML = "^6.0"\n');
    expect(uncoveredPackages(pathsFor(root), [{ id: "T01", base }]).sort()).toEqual(["github.com/redis/go-redis/v9", "httpx", "pyyaml"]);
    write(root, ".aidw/research/docs/httpx@0.27-timeouts.md", BRIEF("httpx", "0.27.0", "timeouts"));
    expect(uncoveredPackages(pathsFor(root), [{ id: "T01", base, docs: ["go-redis@9.5.1 pipelines"] }]).sort()).toEqual(["pyyaml"]);
  });

  it("returns nothing (and does not throw) for a base git does not know, or outside git", () => {
    expect(uncoveredPackages(pathsFor(root), [{ id: "T01", base: "0123456789abcdef0123456789abcdef01234567" }])).toEqual([]);
    commitBase();
    expect(uncoveredPackages(pathsFor(root), [{ id: "T01", base: "0123456789abcdef0123456789abcdef01234567" }])).toEqual([]);
  });

  it("covers a Python package by its Docs Brief whatever its spelling, and merges several task bases", () => {
    write(root, "requirements.txt", "fastapi==0.110.0\n");
    const base1 = commitBase();
    write(root, "x.txt", "x");
    g("add", "-A");
    g("commit", "-q", "-m", "two");
    const base2 = g("rev-parse", "HEAD");
    write(root, "requirements.txt", "fastapi==0.110.0\nPyYAML==6.0.1\nhttpx==0.27.0\n");
    write(root, ".aidw/research/docs/pyyaml@6.0-loading.md", BRIEF("pyyaml", "6.0.1", "loading"));
    expect(uncoveredPackages(pathsFor(root), [{ id: "T01", base: base1 }, { id: "T02", base: base2 }])).toEqual(["httpx"]);
  });
});
