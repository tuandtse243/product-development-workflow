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
  /** Skills that load with the pack for the Roles that read it (`skills: [fastapi/fastapi]`), ADR-0005 */
  skills: string[];
  /** Skills that load with the review of a task on this framework */
  reviewSkills: string[];
  /**
   * The key of the detected stack the pack matches (`detected_as: server` for Express, Fastify, Hono); `framework` when
   * absent. A pack of a server library loads only when no `framework` pack matches: inside NestJS or Next.js the
   * framework's own conventions win over those of the HTTP library underneath.
   */
  detectedAs: string;
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
    const h = head as { framework?: unknown; roles?: unknown; skills?: unknown; review_skills?: unknown; detected_as?: unknown } | null;
    const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
    if (typeof h?.framework === "string" && Array.isArray(h.roles)) {
      out.push({ id: name.slice(0, -3), framework: h.framework, roles: h.roles.map(String), file: join(dir, name), skills: strs(h.skills), reviewSkills: strs(h.review_skills), detectedAs: typeof h.detected_as === "string" ? h.detected_as : "framework" });
    }
  }
  return out;
}

/** The packs of the project's framework, whoever reads them: a reviewer takes their review Skills. */
export function packsOf(root: string, stack: Record<string, string>): FrameworkPack[] {
  const all = frameworkPacks(root);
  const hit = (p: FrameworkPack) => (stack[p.detectedAs] ?? "").toLowerCase().startsWith(p.framework.toLowerCase());
  const frameworks = all.filter((p) => p.detectedAs === "framework" && hit(p));
  return frameworks.length ? frameworks : all.filter((p) => p.detectedAs !== "framework" && hit(p));
}

/** The framework packs a Role reads for a project whose detected stack is `stack` (`framework: "Next.js 15.2"`). */
export function packsFor(root: string, stack: Record<string, string>, role: string): FrameworkPack[] {
  return packsOf(root, stack).filter((p) => p.roles.includes(role));
}
