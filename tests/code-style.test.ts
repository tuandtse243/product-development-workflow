import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const plugin = join(__dirname, "..", "plugins", "aidw");
const read = (p: string) => readFileSync(join(plugin, p), "utf8");

describe("code style profile", () => {
  it("start makes the scaffold task follow it", () => {
    expect(read("skills/start/SKILL.md")).toContain("profiles/code-style.md");
    expect(read("skills/start/SKILL.md")).toContain("profiles/stacks/node.md");
  });

  it("covers prettier, eslint, husky and lint-staged, and leaves brownfield alone", () => {
    const p = read("profiles/stacks/node.md");
    for (const w of ["prettier", "eslint", "husky", "lint-staged", ".husky/pre-commit"]) expect(p).toContain(w);
    expect(read("profiles/code-style.md")).toContain("Brownfield");
  });

  it("scaffolds commitlint and tasks state a commit type", () => {
    const p = read("profiles/stacks/node.md");
    for (const w of ["@commitlint/config-conventional", ".husky/commit-msg", "header-max-length"]) expect(p).toContain(w);
    expect(read("skills/start/SKILL.md")).toMatch(/type: feat/);
  });

  it("the code layer checks formatting for every stack", () => {
    const rows = read("profiles/quality-layers.md").split("\n").filter((l) => /^\| (Next\.js|Vite|NestJS)/.test(l));
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r).toContain("pnpm format:check");
  });

  it("implementer formats its files because worktrees skip the hook", () => {
    expect(read("agents/implementer.md")).toMatch(/formatter[^\n]*finish by running it/);
  });
});
