import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { loadEvalCases } from "../src/evals.js";

// The end of the rpi-upgrades Change (plan T15; M6, M7): its new terms are defined in CONTEXT.md and used by the docs,
// the docs name the Artifacts and commands it added, the stage counts the factory doc states match the Workflow files,
// and every Authored Skill it added is covered by at least one Role eval.
const repo = join(__dirname, "..");
const plugin = join(repo, "plugins", "aidw");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const DOCS = ["docs/user-guide.md", "docs/factory-architecture.md"];

// The Authored Skills this Change added: `roles/<role>/skills/<name>.md` as `<role>:<name>`, library ones as `library/<name>`.
const ADDED_SKILLS = [
  "documentation:pr-summary",
  "research:codebase-research",
  "research:docs-research",
  "software-architect:program-design",
  "library/html-pages",
];
const TERMS = ["System Design", "Program Design", "Design Question", "Pattern to Follow", "View", "Existing System Report", "Docs Brief"];
const ARTIFACTS = ["docs-brief", "existing-system", "program-design", "pr-summary"];
const BASE = "feat/factory-run-to-pr";

const skillPath = (s: string) => {
  const lib = /^library\/(.+)$/.exec(s);
  if (lib) return join(plugin, "library", "skills", lib[1] as string, "SKILL.md");
  const [role, name] = s.split(":") as [string, string];
  return join(plugin, "roles", role, "skills", `${name}.md`);
};

/** What the Role evals cover: `<role>:<skill>` for a Role's own Skill, `library/<name>` from any Role. */
function covered(): Set<string> {
  const out = new Set<string>();
  for (const role of readdirSync(join(plugin, "roles"))) {
    for (const c of loadEvalCases(plugin, role).cases) {
      for (const k of c.covers) out.add(k.startsWith("library/") ? k : `${role}:${k}`);
    }
  }
  return out;
}

describe("rpi-upgrades: every new Authored Skill has a Role eval (M7)", () => {
  it("covers each added Authored Skill with at least one eval's covers:", () => {
    const cov = covered();
    for (const s of ADDED_SKILLS) expect(existsSync(skillPath(s)), `${s} exists`).toBe(true);
    expect(ADDED_SKILLS.filter((s) => !cov.has(s))).toEqual([]);
  });

  it("lists every Authored Skill the branch added since its base", () => {
    // Guards the list above against a Skill added later in the Change; skipped where the base ref is not available.
    let names: string[];
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", BASE], { cwd: repo, stdio: "ignore" });
      names = execFileSync("git", ["diff", "--name-only", "--diff-filter=A", `${BASE}...HEAD`], { cwd: repo, encoding: "utf8" }).split("\n");
    } catch {
      return;
    }
    const added = names.flatMap((f) => {
      const role = /^plugins\/aidw\/roles\/([^/]+)\/skills\/([^/]+)\.md$/.exec(f);
      if (role) return [`${role[1]}:${role[2]}`];
      const lib = /^plugins\/aidw\/library\/skills\/([^/]+)\/SKILL\.md$/.exec(f);
      return lib ? [`library/${lib[1]}`] : [];
    });
    expect(added.filter((s) => !ADDED_SKILLS.includes(s))).toEqual([]);
  });
});

describe("rpi-upgrades: terms and docs (M6)", () => {
  const context = read("CONTEXT.md");

  it("defines each new term in CONTEXT.md with a definition under it", () => {
    for (const t of TERMS) {
      const m = new RegExp(`^\\*\\*${t}\\*\\*:\\n(.+)`, "m").exec(context);
      expect(m, t).not.toBeNull();
      expect((m?.[1] ?? "").trim().length, t).toBeGreaterThan(20);
    }
  });

  it("uses each new term in the user guide and the factory doc", () => {
    // plural forms count ("Patterns to Follow", "Docs Briefs")
    const pattern = (t: string) => new RegExp(t.split(" ").map((w) => `${w}s?`).join("\\s+"));
    for (const doc of DOCS) {
      const text = read(doc);
      expect(TERMS.filter((t) => !pattern(t).test(text)), doc).toEqual([]);
    }
  });

  it("names the Artifacts and the command the Change added", () => {
    const registry = YAML.parse(readFileSync(join(plugin, "artifacts.yaml"), "utf8")) as Record<string, unknown>;
    for (const a of ARTIFACTS) expect(Object.keys(registry), a).toContain(a);
    for (const doc of DOCS) {
      const text = read(doc);
      expect(ARTIFACTS.filter((a) => !text.includes(a)), doc).toEqual([]);
      expect(text, doc).toMatch(/aidw docs-brief/);
    }
  });

  it("states stage counts of the Workflow files that match those files", () => {
    const text = read("docs/factory-architecture.md");
    const dir = join(plugin, "workflows");
    const stated: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".yaml"))) {
      const id = f.slice(0, -5);
      const wf = YAML.parse(readFileSync(join(dir, f), "utf8")) as { stages?: unknown[] };
      // "`product` has 19 stages", "`feature` 20": a backticked Workflow id followed by a number
      for (const m of text.matchAll(new RegExp(`\`${id}\`(?: has)? (\\d+)(?: stages)?\\b`, "g"))) {
        stated.push(id);
        expect(Number(m[1]), `${id} in docs/factory-architecture.md`).toBe(wf.stages?.length);
      }
    }
    expect(stated).toEqual(expect.arrayContaining(["product", "feature"]));
  });

  it("names the stages the Change added to the Workflows in the factory doc", () => {
    const text = read("docs/factory-architecture.md");
    for (const f of ["product.yaml", "feature.yaml"]) {
      const wf = YAML.parse(readFileSync(join(plugin, "workflows", f), "utf8")) as { stages: { id: string }[] };
      const ids = wf.stages.map((s) => s.id);
      for (const s of ["system-design-round", "program-design"]) {
        expect(ids, f).toContain(s);
        expect(text).toContain(`\`${s}\``);
      }
    }
  });
});
