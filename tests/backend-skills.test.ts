import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";

// The backend Role's Authored Skills (plan T14, R3, ADR-0005): each has a name and a description, a right/wrong
// example pair, and ends with the Sources it takes ideas from.
const plugin = join(__dirname, "..", "plugins", "aidw");
const dir = join(plugin, "roles", "backend", "skills");
const SKILLS = ["endpoint-test-matrix", "transactions-and-races", "repeat-safe-writes", "effects-after-commit", "server-logs-and-errors", "query-shape"];

function parse(file: string): { meta: Record<string, unknown>; body: string } {
  const text = readFileSync(file, "utf8");
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${file}: no front matter`);
  return { meta: YAML.parse(m[1]!) as Record<string, unknown>, body: m[2]! };
}

describe("backend skills", () => {
  it("ships the six skills the backend Role lists", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
    expect(files).toEqual(expect.arrayContaining(SKILLS));
  });

  it.each(readdirSync(dir).filter((f) => f.endsWith(".md")))("%s has a name, a description, a right/wrong pair and Sources last", (f) => {
    const { meta, body } = parse(join(dir, f));
    expect(meta.name).toBe(f.replace(/\.md$/, ""));
    expect(typeof meta.description === "string" && meta.description.length > 20).toBe(true);
    const headings = [...body.matchAll(/^## (.+)$/gm)].map((h) => h[1]!.trim());
    expect(headings).toContain("Right and wrong");
    expect(headings.at(-1)).toBe("Sources");
    const pair = body.slice(body.indexOf("## Right and wrong"), body.indexOf("## Sources"));
    expect(pair).toMatch(/^Right\b/m);
    expect(pair).toMatch(/^Wrong\b/m);
    expect(body.slice(body.indexOf("## Sources")).trim().split("\n").length).toBeGreaterThan(1);
  });

  it("names a Consultation where the contract or the schema has a hole, instead of a guess", () => {
    for (const s of SKILLS) expect(readFileSync(join(dir, `${s}.md`), "utf8"), s).toMatch(/Consultation/);
  });

  it("server-logs-and-errors names the vendored secret-serialization skill and when to load it", () => {
    const text = readFileSync(join(dir, "server-logs-and-errors.md"), "utf8");
    expect(text).toMatch(/When to load `sentry\/secret-serialization`/);
    expect(parse(join(dir, "server-logs-and-errors.md")).body.split("## Sources")[1]).toMatch(/secret-serialization/);
    expect(existsSync(join(plugin, "library", "vendor", "sentry", "secret-serialization", "SKILL.md"))).toBe(true);
  });

  it("repeat-safe-writes cites api-design-rules instead of restating it", () => {
    expect(readFileSync(join(dir, "repeat-safe-writes.md"), "utf8")).toMatch(/`api-design-rules`, section\s+"Writes that may be\s+repeated"/);
  });
});
