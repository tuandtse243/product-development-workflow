import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

/**
 * Framework packs (ADR-0001, amendment): `stacks/<id>.md` whose front matter names the framework `aidw detect` reports
 * (`framework: Next.js`) and the Roles that read it (`roles: [frontend, backend, fullstack]`). Adding a framework is adding
 * one file; no Role and no CLI code names it. A Role never reads the pack of a framework it does not build with.
 */
export interface FrameworkPack {
  id: string;
  framework: string;
  roles: string[];
  file: string;
}

export function frameworkPacks(root: string): FrameworkPack[] {
  const dir = join(root, "stacks");
  if (!existsSync(dir)) return [];
  const out: FrameworkPack[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
    const m = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(join(dir, name), "utf8"));
    if (!m) continue;
    let head: unknown;
    try {
      head = YAML.parse(m[1] as string);
    } catch {
      continue;
    }
    const h = head as { framework?: unknown; roles?: unknown } | null;
    if (typeof h?.framework === "string" && Array.isArray(h.roles)) out.push({ id: name.slice(0, -3), framework: h.framework, roles: h.roles.map(String), file: join(dir, name) });
  }
  return out;
}

/** The framework packs a Role reads for a project whose detected stack is `stack` (`framework: "Next.js 15.2"`). */
export function packsFor(root: string, stack: Record<string, string>, role: string): FrameworkPack[] {
  const found = stack.framework ?? "";
  return frameworkPacks(root).filter((p) => p.roles.includes(role) && found.toLowerCase().startsWith(p.framework.toLowerCase()));
}
