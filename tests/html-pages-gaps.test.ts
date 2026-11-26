import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { checkEvals, loadEvalCases } from "../src/evals.js";
import { loadRole } from "../src/roles.js";

// Gaps around rpi-upgrades T2 (Q8, Q8b): every path the html-pages and show-me skills tell an Agent to resolve
// exists, through the source CLI and the built bundle; the two user skills register like the other plugin commands;
// each example number in the html-pages table matches what the vendored file of that number is; the Role eval passes
// the roster's eval checks.
const plugin = join(__dirname, "..", "plugins", "aidw");
const bundle = join(plugin, "bin", "aidw");
const examples = join(plugin, "library", "vendor", "anthropics", "html-effectiveness");
const skillFiles = {
  library: join(plugin, "library", "skills", "html-pages", "SKILL.md"),
  "show-me": join(plugin, "skills", "show-me", "SKILL.md"),
  "html-pages": join(plugin, "skills", "html-pages", "SKILL.md"),
};

function frontMatter(file: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(file, "utf8"));
  if (!m) throw new Error(`${file}: no front matter`);
  return YAML.parse(m[1]!) as Record<string, unknown>;
}
const cli = (args: string[]) => {
  let out = "";
  let err = "";
  const code = run(args, {}, plugin, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out: out.trim(), err };
};
/** Every literal `aidw vendor-path X` / `aidw plugin-path Y` in a file, placeholders like `<file>` left out. */
function references(file: string): string[][] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/aidw (vendor-path|plugin-path) ([A-Za-z0-9_./-]+)(?=[`)])/g)].map((m) => [m[1]!, m[2]!]);
}

describe("every path the skills tell an Agent to resolve exists (Q8)", () => {
  it.each(Object.entries(skillFiles))("%s: each vendor-path and plugin-path resolves to an existing file", (_name, file) => {
    const refs = references(file);
    expect(refs.length).toBeGreaterThan(0);
    for (const [cmd, ref] of refs) {
      const r = cli([cmd!, ref!]);
      expect(r.code, `${cmd} ${ref}: ${r.err}`).toBe(0);
      expect(existsSync(r.out), r.out).toBe(true);
    }
  });

  it("the example path pattern the library skill gives resolves for each of the 20 examples", () => {
    const text = readFileSync(skillFiles.library, "utf8");
    expect(text).toContain("aidw plugin-path library/vendor/anthropics/html-effectiveness/<file>.html");
    for (const f of readdirSync(examples).filter((n) => n.endsWith(".html"))) {
      const r = cli(["plugin-path", `library/vendor/anthropics/html-effectiveness/${f}`]);
      expect(r.code, f).toBe(0);
      expect(existsSync(r.out), f).toBe(true);
    }
  });

  it("the built bundle resolves both library files the user commands load", () => {
    expect(existsSync(bundle), "run the build first").toBe(true);
    for (const [ref, rel] of [
      ["humanlayer/show-me", "library/vendor/humanlayer/show-me/SKILL.md"],
      ["aidw/html-pages", "library/skills/html-pages/SKILL.md"],
    ] as const) {
      const r = spawnSync(process.execPath, [bundle, "vendor-path", ref], {
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: plugin },
      });
      expect(r.status, `${ref}: ${r.stderr}`).toBe(0);
      expect(r.stdout.trim()).toBe(join(plugin, rel));
      expect(existsSync(r.stdout.trim())).toBe(true);
    }
  });

  it("the vendored-skill notes have the sections the user commands name", () => {
    const notes = readFileSync(join(plugin, "library", "vendored-skill-notes.md"), "utf8");
    expect(notes).toMatch(/^## humanlayer\/show-me$/m);
    expect(notes).toMatch(/^## anthropics\/html-effectiveness\b/m);
  });
});

describe("show-me and html-pages register as plugin commands like the others (Q8)", () => {
  it("every plugin skill directory holds a SKILL.md whose name is its directory", () => {
    const dirs = readdirSync(join(plugin, "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(dirs).toEqual(expect.arrayContaining(["show-me", "html-pages"]));
    for (const d of dirs) expect(frontMatter(join(plugin, "skills", d, "SKILL.md")).name, d).toBe(d);
  });

  it.each(["show-me", "html-pages"])("%s has a description, an argument hint, and stays callable by the model", (name) => {
    const meta = frontMatter(join(plugin, "skills", name, "SKILL.md"));
    expect(String(meta.description)).toMatch(/^.{40,}$/);
    expect(typeof meta["argument-hint"]).toBe("string");
    // Q8: show-me serves every question to a user and html-pages every HTML page, also when an Agent needs one,
    // so neither is limited to an explicit /aidw: call.
    expect(meta["disable-model-invocation"]).toBeUndefined();
  });

  it("show-me only shows: it changes no code and records no decision", () => {
    const text = readFileSync(skillFiles["show-me"], "utf8");
    expect(text).toMatch(/Do not change code or record a decision/);
  });

  it("neither command opens the page it writes", () => {
    for (const f of [skillFiles["show-me"], skillFiles["html-pages"]]) {
      const text = readFileSync(f, "utf8");
      expect(text).toMatch(/Never open\s+it/);
      expect(String(frontMatter(f)["allowed-tools"])).not.toMatch(/open|Bash\(\*\)/);
    }
  });
});

describe("example numbers in the html-pages table match the vendored files (Q8, Q8b)", () => {
  // What the file name of each vendored example says, and a word its row must use for the kind of page.
  const kinds: Record<string, RegExp> = {
    "01": /approaches/i,
    "02": /looks|design directions/i,
    "03": /review/i,
    "04": /how code works/i,
    "05": /tokens/i,
    "06": /variants/i,
    "07": /motion/i,
    "08": /interaction/i,
    "09": /summary/i,
    "10": /drawing|svg/i,
    "11": /progress/i,
    "12": /went wrong/i,
    "13": /workflow|pipeline/i,
    "14": /feature/i,
    "15": /concept/i,
    "16": /plan/i,
    "17": /pull request/i,
    "18, 19, 20": /edits/i,
  };
  const slugs: Record<string, RegExp> = {
    "01": /code-approaches/,
    "04": /code-understanding/,
    "16": /implementation-plan/,
    "17": /pr-writeup/,
    "18": /editor-/,
    "19": /editor-/,
    "20": /editor-/,
  };
  const body = readFileSync(skillFiles.library, "utf8");
  const rows = new Map(
    body
      .split("\n")
      .map((l) => /^\| (\d\d(?:, \d\d)*) \| ([^|]+)\|/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1]!, m[2]!]),
  );
  const files = readdirSync(examples).filter((n) => n.endsWith(".html"));

  it.each(Object.entries(kinds))("row %s names the kind of page its example is", (num, kind) => {
    expect(rows.get(num), num).toMatch(kind);
  });

  it.each(Object.entries(slugs))("example %s is the vendored file the row means", (num, slug) => {
    const f = files.find((n) => n.startsWith(`${num}-`));
    expect(f, num).toBeDefined();
    expect(f).toMatch(slug);
  });

  it("the CLI layouts sit on the rows of 01, 04, 16 and 17 and on no other row (Q8b)", () => {
    const layouts: Record<string, string> = { "01": "approaches", "04": "walkthrough", "16": "plan", "17": "before-after" };
    for (const [num, kind] of rows) {
      const layout = layouts[num];
      if (layout) expect(kind, num).toContain(`CLI layout \`${layout}\``);
      else expect(kind, num).not.toMatch(/CLI layout/);
    }
  });
});

describe("the Role eval passes the roster's checks (M7)", () => {
  it("the html-pages case covers a skill the documentation Role lists, with no eval error", () => {
    const { cases, diags } = loadEvalCases(plugin, "documentation");
    const c = cases.find((x) => x.name === "walkthrough-page-without-script" || x.file.endsWith("walkthrough-page-without-script.md"));
    expect(c).toBeDefined();
    expect(c!.covers).toEqual(["library/html-pages"]);
    expect(loadRole(plugin, "documentation")!.skills.map((s) => s.name)).toContain("library/html-pages");
    expect(diags.items.filter((i) => i.level === "error")).toEqual([]);
    const all = checkEvals(plugin).items.filter((i) => i.level === "error");
    expect(all, JSON.stringify(all)).toEqual([]);
  });

  it("aidw roster reports no error", () => {
    const r = cli(["roster"]);
    expect(r.code, r.out + r.err).toBe(0);
    expect(r.out).toMatch(/OK: 0 error\(s\)/);
  });

  it("the eval's criteria name the static rules and the hand-over as a link", () => {
    const text = readFileSync(join(plugin, "roles", "documentation", "evals", "walkthrough-page-without-script.md"), "utf8");
    const criteria = text.split("## Criteria")[1] ?? "";
    expect(criteria).toMatch(/&lt;/);
    expect(criteria).toMatch(/<details>/);
    expect(criteria).toMatch(/must not open the page/);
    expect(criteria).toMatch(/dark-mode/);
  });
});
