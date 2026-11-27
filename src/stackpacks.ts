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
  /**
   * More keys of the detected stack the pack needs, each matched as `detected_as` is (`requires: { ui: React }`): the Vite
   * pack is for Vite with React, not Vite with Vue or Svelte. Empty when absent.
   */
  requires: Record<string, string>;
  /**
   * Values of detected-stack keys that keep the pack out (`excludes: { framework: [Astro, Remix] }`), each matched as
   * `detected_as` is: the Vite pack is for a browser-only app, not for Astro or Remix, which render on a server. Empty when absent.
   */
  excludes: Record<string, string[]>;
}

function excludesOf(v: unknown): Record<string, string[]> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, l]) => [k, (Array.isArray(l) ? l : [l]).filter((x) => typeof x === "string") as string[]]));
}

function requiresOf(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"));
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
    const h = head as { framework?: unknown; roles?: unknown; skills?: unknown; review_skills?: unknown; detected_as?: unknown; requires?: unknown; excludes?: unknown } | null;
    const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
    if (typeof h?.framework === "string" && Array.isArray(h.roles)) {
      out.push({ id: name.slice(0, -3), framework: h.framework, roles: h.roles.map(String), file: join(dir, name), skills: strs(h.skills), reviewSkills: strs(h.review_skills), detectedAs: typeof h.detected_as === "string" ? h.detected_as : "framework", requires: requiresOf(h.requires), excludes: excludesOf(h.excludes) });
    }
  }
  return out;
}

/**
 * The packs of the project's framework, whoever reads them: a reviewer takes their review Skills. A pack of a bundler or
 * server library yields to the framework packs that serve the same Roles (the reading `role`, or any Role of that pack):
 * a NestJS API in the same root does not take the Vite + React pack away from the frontend.
 */
export function packsOf(root: string, stack: Record<string, string>, role?: string): FrameworkPack[] {
  const all = frameworkPacks(root);
  const starts = (key: string, name: string) => (stack[key] ?? "").toLowerCase().startsWith(name.toLowerCase());
  const hit = (p: FrameworkPack) =>
    starts(p.detectedAs, p.framework) &&
    Object.entries(p.requires).every(([k, n]) => starts(k, n)) &&
    !Object.entries(p.excludes).some(([k, names]) => names.some((n) => starts(k, n)));
  const frameworks = all.filter((p) => p.detectedAs === "framework" && hit(p));
  const sharing = (p: FrameworkPack) => frameworks.some((f) => (role ? f.roles.includes(role) : f.roles.some((r) => p.roles.includes(r))));
  return [...frameworks, ...all.filter((p) => p.detectedAs !== "framework" && hit(p) && !sharing(p))];
}

/** The framework packs a Role reads for a project whose detected stack is `stack` (`framework: "Next.js 15.2"`). */
export function packsFor(root: string, stack: Record<string, string>, role: string): FrameworkPack[] {
  return packsOf(root, stack, role).filter((p) => p.roles.includes(role));
}
