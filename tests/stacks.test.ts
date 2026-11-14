import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isGeneratedPath } from "../src/git.js";

const plugin = join(__dirname, "..", "plugins", "aidw");
const stacks = join(plugin, "stacks");

/** ADR-0001: every stack pack answers the same questions under the same headings. */
const HEADINGS = [
  "Package manager and install",
  "Formatter",
  "Linter",
  "Typecheck",
  "Test runner and JUnit output",
  "Pre-commit hook",
  "Commit messages",
  "Paths never committed",
  ".gitignore template",
  "CI",
];

describe("stack packs", () => {
  const packs = readdirSync(stacks).filter((f) => f.endsWith(".md"));

  it("has at least the node pack", () => {
    expect(packs).toContain("node.md");
  });

  it.each(packs)("%s answers every standard question", (file) => {
    const text = readFileSync(join(stacks, file), "utf8");
    const got = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    for (const h of HEADINGS) expect(got, `${file} lacks "## ${h}"`).toContain(h);
  });

  it("the CI profile mirrors the code and unit layers", () => {
    const ci = readFileSync(join(plugin, "roles", "devops", "references", "ci.md"), "utf8");
    expect(ci).toMatch(/code.*unit.*integration/s);
    expect(ci).toContain("--frozen-lockfile");
  });

  it("junk paths of each stack are refused", () => {
    for (const f of ["node_modules/x/y.js", ".pnpm-store/a", "app/__pycache__/m.pyc", ".venv/bin/python", "web/next-env.d.ts", "a.tsbuildinfo", "mod.pyc"]) {
      expect(isGeneratedPath(f), f).toBe(true);
    }
    expect(isGeneratedPath("src/index.ts")).toBe(false);
  });
});
