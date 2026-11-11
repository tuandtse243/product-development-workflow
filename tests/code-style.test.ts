import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const plugin = join(__dirname, "..", "plugins", "aidw");
const read = (p: string) => readFileSync(join(plugin, p), "utf8");

describe("code style profile", () => {
  it("start makes the scaffold task follow it", () => {
    expect(read("skills/start/SKILL.md")).toContain("profiles/code-style.md");
  });

  it("covers prettier, eslint, husky and lint-staged, and leaves brownfield alone", () => {
    const p = read("profiles/code-style.md");
    for (const w of ["prettier", "eslint", "husky", "lint-staged", ".husky/pre-commit", "Brownfield"]) expect(p).toContain(w);
  });

  it("the code layer checks formatting for every stack", () => {
    const rows = read("profiles/quality-layers.md").split("\n").filter((l) => /^\| (Next\.js|Vite|NestJS)/.test(l));
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r).toContain("pnpm format:check");
  });

  it("implementer formats its files because worktrees skip the hook", () => {
    expect(read("agents/implementer.md")).toContain("prettier --write");
  });
});
