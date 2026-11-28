import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SKILLS_WITH_NOTES } from "../src/skills.js";

// The show-me skill (humanlayer) and the 20 html-effectiveness example pages (anthropics), vendored word for word
// under ADR-0005 (rpi-upgrades I7, Q6).
const root = join(__dirname, "..");
const vendor = join(root, "plugins", "aidw", "library", "vendor");
const config = JSON.parse(readFileSync(join(root, "scripts", "vendor.config.json"), "utf8")) as Record<
  string,
  { repo: string; dest?: string; skills: Record<string, string>; files?: Record<string, string> }
>;
const destOf = (key: string) => join(vendor, config[key]?.dest ?? key);

describe("humanlayer/show-me", () => {
  it("is configured from plugins/show-me of humanlayer/skills", () => {
    expect(config.humanlayer?.repo).toBe("humanlayer/skills");
    expect(config.humanlayer?.skills).toEqual({ "show-me": "plugins/show-me/skills/show-me" });
    expect(destOf("humanlayer")).toBe(join(vendor, "humanlayer"));
  });

  it("is vendored with its licence and the upstream commit", () => {
    expect(existsSync(join(vendor, "humanlayer", "show-me", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(vendor, "humanlayer", "LICENSE"), "utf8")).toMatch(/MIT License/);
    expect(readFileSync(join(vendor, "humanlayer", "UPSTREAM.md"), "utf8")).toMatch(/humanlayer\/skills[\s\S]*Commit: `[0-9a-f]{40}`/);
  });

  it("resolves through aidw vendor-path", () => {
    const out = execFileSync(resolve(root, "plugins/aidw/bin/aidw"), ["vendor-path", "humanlayer/show-me"], { encoding: "utf8" }).trim();
    expect(out).toBe(join(vendor, "humanlayer", "show-me", "SKILL.md"));
  });

  it("has notes, since it opens its page with Bash(open ...)", () => {
    expect(SKILLS_WITH_NOTES.has("humanlayer/show-me")).toBe(true);
  });
});

describe("anthropics/html-effectiveness", () => {
  const dir = join(vendor, "anthropics", "html-effectiveness");

  it("lands in vendor/anthropics/html-effectiveness, apart from the anthropic upstream", () => {
    expect(config["html-effectiveness"]?.repo).toBe("anthropics/html-effectiveness");
    expect(destOf("html-effectiveness")).toBe(dir);
    expect(destOf("anthropic")).toBe(join(vendor, "anthropic"));
  });

  it("configures all 20 numbered examples, each under its own name", () => {
    const files = Object.entries(config["html-effectiveness"]?.files ?? {});
    expect(files).toHaveLength(20);
    for (const [to, from] of files) expect(to).toBe(from);
    expect(files.map(([to]) => to.slice(0, 2))).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, "0")));
  });

  it("is vendored with every example, its licence and the upstream commit", () => {
    const html = readdirSync(dir).filter((f) => f.endsWith(".html")).sort();
    expect(html).toEqual(Object.keys(config["html-effectiveness"]?.files ?? {}).sort());
    expect(readFileSync(join(dir, "LICENSE"), "utf8")).toMatch(/MIT License/);
    expect(readFileSync(join(dir, "UPSTREAM.md"), "utf8")).toMatch(/anthropics\/html-effectiveness[\s\S]*Commit: `[0-9a-f]{40}`/);
  });
});

describe("vendored-skill-notes.md", () => {
  const notes = readFileSync(join(root, "plugins", "aidw", "library", "vendored-skill-notes.md"), "utf8");
  const section = (heading: string) => notes.split(/^## /m).find((s) => s.startsWith(heading)) ?? "";

  it("says show-me's page is shown as a link, not opened", () => {
    const s = section("humanlayer/show-me");
    expect(s).toMatch(/open/);
    expect(s).toMatch(/link/);
  });

  it("has a section for the html-effectiveness examples", () => {
    expect(section("anthropics/html-effectiveness")).not.toBe("");
  });
});
