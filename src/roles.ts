import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { Diags } from "./diag.js";
import { bundledRoot } from "./plugin.js";

/**
 * The factory's organization (docs/factory-architecture.md, ADR-0004).
 *
 *   roster.yaml           every Role: department, status, who carries a planned Role's work
 *   roles/<id>/role.md    the Role's profile: a YAML header and the text its Agent starts from
 *   roles/<id>/rules.md   the Role's rules, always loaded with the profile
 *   tiers.yaml            tier -> model, per platform
 *   agents/<id>.md        GENERATED from the above for Claude Code; never edited by hand
 */

export const ROLE_STATUSES = ["active", "planned"] as const;
export const RUN_MODES = ["interactive", "worker"] as const;
export const TIERS = ["deep", "standard", "fast"] as const;
/**
 * What the gate lets a Role's Agent do:
 *   write      edits project files (the implementing Roles); never `.aidw/`
 *   artifacts  drafts Artifacts under `.aidw/` before the Approval Gate; the gate's normal rules apply
 *   read-only  writes only its verdict
 */
export const ACCESS = ["write", "artifacts", "read-only"] as const;

export type Tier = (typeof TIERS)[number];
export type Access = (typeof ACCESS)[number];

const ROLE_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The Agents the CLI tells the orchestrator to spawn, each `aidw:<role id>`: the `agents:` of the build stage in
 * workflows/product.yaml (every Workflow file must list the same ones, which `aidw roster` checks).
 */
export const AGENTS = loadAgents();

/** The Role that runs tasks the workflow adds itself (quality fixes, converge gaps, integration fixes). */
export const DEFAULT_TASK_ROLE = AGENTS.implement.replace(/^aidw:/, "");

function loadAgents(): { implement: string; taskReview: string; layerReview: { ui: string; security: string } } {
  const root = bundledRoot();
  const file = root ? join(root, "workflows", "product.yaml") : "";
  const data = file && existsSync(file) ? (YAML.parse(readFileSync(file, "utf8")) as { stages?: unknown } | null) : null;
  const stages = Array.isArray(data?.stages) ? (data.stages as Record<string, unknown>[]) : [];
  const agents = stages.map((s) => s?.agents).find(isRecord);
  const layer = isRecord(agents?.["layer-review"]) ? (agents["layer-review"] as Record<string, unknown>) : {};
  const [implement, review, ui, security] = [agents?.implement, agents?.review, layer.ui, layer.security];
  for (const v of [implement, review, ui, security]) {
    if (typeof v !== "string" || !ROLE_ID.test(v)) throw new Error(`the Agents are missing: ${file || "plugin root not found"} needs a stage with agents: implement, review and layer-review ui and security`);
  }
  return { implement: `aidw:${implement}`, taskReview: `aidw:${review}`, layerReview: { ui: `aidw:${ui}`, security: `aidw:${security}` } };
}

export interface RosterEntry {
  department: string;
  status: (typeof ROLE_STATUSES)[number];
  carried_by?: string;
}

export interface Roster {
  departments: Record<string, string>;
  roles: Record<string, RosterEntry>;
}

export interface RoleProfile {
  id: string;
  description: string;
  mode: (typeof RUN_MODES)[number];
  tier: Tier;
  access: Access;
  tools: string[];
  max_turns?: number;
  /** on-demand skills of this Role: name -> when to load it (the file is roles/<id>/skills/<name>.md) */
  skills: { name: string; when: string }[];
  /** plugin-relative files whose text every Agent of this Role also gets (shared procedures) */
  includes: string[];
  /** role.md after its header */
  body: string;
  /** the text of `includes`, in order */
  shared: string[];
  /** rules.md, empty when the Role has none */
  rules: string;
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

export const rosterFile = (root: string) => join(root, "roster.yaml");
export const roleDir = (root: string, id: string) => join(root, "roles", id);
const read = (file: string) => readFileSync(file, "utf8");

export function loadRoster(root: string): Roster {
  const data = YAML.parse(read(rosterFile(root))) as unknown;
  const departments = isRecord(data) && isRecord(data.departments) ? (data.departments as Record<string, string>) : {};
  const roles = isRecord(data) && isRecord(data.roles) ? (data.roles as Record<string, RosterEntry>) : {};
  return { departments, roles };
}

export function parseRoleText(text: string): { header: Record<string, unknown>; body: string } | null {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  let header: unknown;
  try {
    header = YAML.parse(m[1] ?? "");
  } catch {
    return null; // checkRoster reports it; a broken profile must never crash the CLI
  }
  return isRecord(header) ? { header, body: (m[2] ?? "").trim() } : null;
}

/** The Role's profile, or null when it has no folder yet. Throws nothing: problems are reported by checkRoster. */
export function loadRole(root: string, id: string): RoleProfile | null {
  const file = join(roleDir(root, id), "role.md");
  if (!existsSync(file)) return null;
  const parsed = parseRoleText(read(file));
  if (!parsed) return null;
  const h = parsed.header;
  const rulesFile = join(roleDir(root, id), "rules.md");
  const includes = Array.isArray(h.includes) ? h.includes.map(String) : [];
  return {
    id: String(h.id ?? ""),
    description: String(h.description ?? ""),
    mode: h.mode as RoleProfile["mode"],
    tier: h.tier as Tier,
    access: h.access as Access,
    tools: Array.isArray(h.tools) ? h.tools.map(String) : [],
    ...(typeof h.max_turns === "number" ? { max_turns: h.max_turns } : {}),
    skills: skillIndex(h.skills),
    includes,
    body: parsed.body,
    shared: includes.map((f) => (existsSync(join(root, f)) ? read(join(root, f)).trim() : "")),
    rules: existsSync(rulesFile) ? read(rulesFile).trim() : "",
  };
}

/** `skills: [{ name: when }]` -> a list; anything else is reported by checkRoster. */
function skillIndex(raw: unknown): { name: string; when: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e) => (isRecord(e) ? Object.entries(e).map(([name, when]) => ({ name, when: String(when) })) : []));
}

export function loadTiers(root: string, platform = "claude-code"): Record<string, string> {
  const file = join(root, "tiers.yaml");
  const data = existsSync(file) ? (YAML.parse(read(file)) as unknown) : null;
  return isRecord(data) && isRecord(data[platform]) ? (data[platform] as Record<string, string>) : {};
}

/** The Claude Code agent file of one Role. */
export function renderAgent(role: RoleProfile, tiers: Record<string, string>): string {
  const model = tiers[role.tier];
  const head = [
    `name: ${role.id}`,
    `description: ${YAML.stringify(role.description, { lineWidth: 0 }).trim()}`,
    `# GENERATED from roles/${role.id}/ (role.md, rules.md) by \`aidw roster --write\`. Do not edit this file.`,
    `tools: ${role.tools.join(", ")}`,
    ...(model && model !== "inherit" ? [`model: ${model}`] : []),
    ...(role.max_turns ? [`maxTurns: ${role.max_turns}`] : []),
  ];
  const shared = role.shared.filter(Boolean).map((t) => `\n\n${t}`).join("");
  const rules = role.rules ? `\n\n## Rules\n\n${role.rules}` : "";
  const skills = role.skills.length
    ? `\n\n## Skills (load only when the work needs one)\n\nRead a skill with \`aidw plugin-path roles/${role.id}/skills/<name>.md\`.\n\n${role.skills.map((s) => `- \`${s.name}\`: ${s.when}`).join("\n")}`
    : "";
  return `---\n${head.join("\n")}\n---\n\n${role.body}${shared}${rules}${skills}\n`;
}

/** Role ids that have a folder under roles/. */
function profiledRoles(root: string): string[] {
  const dir = join(root, "roles");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => statSync(join(dir, n)).isDirectory())
    .sort();
}

/** agents/<id>.md -> content, for every active Role that has a profile. */
export function generateAgents(root: string): Record<string, string> {
  const roster = loadRoster(root);
  const tiers = loadTiers(root);
  const out: Record<string, string> = {};
  for (const [id, entry] of Object.entries(roster.roles)) {
    if (entry?.status !== "active") continue;
    const role = loadRole(root, id);
    if (role) out[`${id}.md`] = renderAgent(role, tiers);
  }
  return out;
}

/** Writes the generated agents and removes any other file in agents/. Returns the files written. */
export function writeAgents(root: string): string[] {
  const dir = join(root, "agents");
  mkdirSync(dir, { recursive: true });
  const files = generateAgents(root);
  for (const name of readdirSync(dir)) if (!(name in files)) rmSync(join(dir, name), { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return Object.keys(files).sort();
}

/** Validates the Roster, every profile and that agents/ matches what the profiles generate. */
export function checkRoster(root: string): Diags {
  const d = new Diags();
  const rf = "roster.yaml";
  if (!existsSync(rosterFile(root))) {
    d.error(rf, "not found");
    return d;
  }
  let roster: Roster;
  try {
    roster = loadRoster(root);
  } catch (e) {
    d.error(rf, `not valid YAML: ${(e as Error).message}`);
    return d;
  }
  const ids = Object.keys(roster.roles);
  if (ids.length === 0) d.error(rf, 'expected a "roles:" mapping');

  for (const id of ids) {
    const e = roster.roles[id];
    if (!ROLE_ID.test(id)) d.error(rf, `role id "${id}" must be lower-case kebab-case`);
    if (!isRecord(e)) {
      d.error(rf, `role ${id} is not a mapping`);
      continue;
    }
    if (typeof e.department !== "string" || !(e.department in roster.departments)) d.error(rf, `role ${id}: unknown department "${String(e.department)}"`);
    if (!oneOf(ROLE_STATUSES, e.status)) d.error(rf, `role ${id}: status must be ${ROLE_STATUSES.join(" or ")}`);
    if (e.status === "active" && e.carried_by !== undefined) d.error(rf, `role ${id} is active, so it cannot have carried_by`);
    if (e.status === "planned") {
      const by = e.carried_by;
      if (typeof by !== "string" || !by) d.error(rf, `role ${id} is planned, so it needs carried_by`);
      else if (by !== "cli" && !/^skill:[a-z0-9-]+$/.test(by) && roster.roles[by]?.status !== "active") {
        d.error(rf, `role ${id}: carried_by "${by}" must be an active role, "cli" or "skill:<name>"`);
      }
    }
  }

  const profiled = profiledRoles(root);
  for (const id of profiled) {
    const file = `roles/${id}/role.md`;
    if (!(id in roster.roles)) d.error(file, `role "${id}" has a folder but is not in roster.yaml`);
    const path = join(roleDir(root, id), "role.md");
    if (!existsSync(path)) {
      d.error(file, "not found");
      continue;
    }
    const parsed = parseRoleText(read(path));
    if (!parsed) {
      d.error(file, "expected a valid YAML header between --- lines (quote any value that contains \": \")");
      continue;
    }
    const h = parsed.header;
    if (h.id !== id) d.error(file, `header id "${String(h.id)}" must equal the folder name "${id}"`);
    if (typeof h.description !== "string" || !h.description.trim()) d.error(file, "header needs a description");
    if (!oneOf(RUN_MODES, h.mode)) d.error(file, `mode must be ${RUN_MODES.join(" or ")}`);
    if (!oneOf(TIERS, h.tier)) d.error(file, `tier must be ${TIERS.join(", ")}`);
    if (!oneOf(ACCESS, h.access)) d.error(file, `access must be one of ${ACCESS.join(", ")}`);
    if (!Array.isArray(h.tools) || h.tools.length === 0 || !h.tools.every((t) => typeof t === "string")) d.error(file, "tools must be a non-empty list of tool names");
    if (h.max_turns !== undefined && !(Number.isInteger(h.max_turns) && Number(h.max_turns) > 0)) d.error(file, "max_turns must be a positive integer");
    if (!parsed.body) d.error(file, "the profile has no text after its header");
    if (h.skills !== undefined) {
      const list = Array.isArray(h.skills) ? h.skills : null;
      if (!list || !list.every((e) => isRecord(e) && Object.keys(e).length === 1 && typeof Object.values(e)[0] === "string")) {
        d.error(file, 'skills must be a list of one-entry mappings: "- <skill-name>: <when to load it>"');
      } else {
        for (const s of skillIndex(h.skills)) {
          if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.name)) d.error(file, `skill name "${s.name}" must be kebab-case`);
          else if (!existsSync(join(roleDir(root, id), "skills", `${s.name}.md`))) d.error(file, `skill "${s.name}" has no file roles/${id}/skills/${s.name}.md`);
        }
      }
    }
    if (h.includes !== undefined) {
      if (!Array.isArray(h.includes) || !h.includes.every((f) => typeof f === "string")) d.error(file, "includes must be a list of plugin-relative file paths");
      else for (const f of h.includes as string[]) if (f.includes("..") || !existsSync(join(root, f))) d.error(file, `includes: "${f}" not found in the plugin`);
    }
    // Department, status and carried_by have one home: roster.yaml.
    for (const k of ["department", "status", "carried_by"]) if (k in h) d.error(file, `"${k}" belongs in roster.yaml, not in the profile`);
  }
  for (const id of ids) {
    if (roster.roles[id]?.status === "active" && !profiled.includes(id)) d.warn(rf, `role ${id} is active but has no profile yet (roles/${id}/role.md)`);
  }
  if (d.errors.length) return d;

  const expected = generateAgents(root);
  const dir = join(root, "agents");
  const present = existsSync(dir) ? readdirSync(dir) : [];
  for (const [name, content] of Object.entries(expected)) {
    const file = join(dir, name);
    if (!existsSync(file)) d.error(`agents/${name}`, "missing: run `npm run build` (or `aidw roster --write`)");
    else if (read(file) !== content) d.error(`agents/${name}`, "out of date with its role folder: run `npm run build` (agent files are generated, never edited)");
  }
  for (const name of present) if (!(name in expected)) d.error(`agents/${name}`, "not generated from a role: agents/ holds only generated files");
  return d;
}

/**
 * The Role whose Agent runs a task owned by `role`: the Role itself when it is active and writes project files, the
 * active Role that carries it when it is Planned (`database` -> `fullstack`), otherwise null (the plan names a Role
 * that cannot run tasks).
 */
export function implementerOf(root: string, role: string | undefined): string | null {
  if (!role) return null;
  try {
    const entry = loadRoster(root).roles[role];
    if (!entry) return null;
    if (entry.status === "active") return roleAccess(root, role) === "write" ? role : null;
    const by = entry.carried_by;
    return by && by !== role ? implementerOf(root, by) : null;
  } catch {
    return null;
  }
}

/** `aidw:<role>` of the Agent for a task; falls back to the default implementer (`aidw analyze` warned about the plan). */
export const agentForTask = (root: string, role: string | undefined): string => `aidw:${implementerOf(root, role) ?? DEFAULT_TASK_ROLE}`;

const accessCache = new Map<string, Access | null>();

/** The access a Role declares, or null when no such Role has a profile. Cached: the gate asks on every tool call. */
export function roleAccess(root: string, id: string): Access | null {
  if (!ROLE_ID.test(id)) return null;
  const key = `${root}\0${id}`;
  const hit = accessCache.get(key);
  if (hit !== undefined) return hit;
  let access: Access | null = null;
  try {
    const role = loadRole(root, id);
    if (role && oneOf(ACCESS, role.access)) access = role.access;
  } catch {
    access = null;
  }
  accessCache.set(key, access);
  return access;
}

/** One line per Role, grouped by department, for `aidw roster`. */
export function rosterTable(root: string): string {
  const roster = loadRoster(root);
  const lines: string[] = [];
  for (const [dep, title] of Object.entries(roster.departments)) {
    lines.push(title);
    for (const [id, e] of Object.entries(roster.roles)) {
      if (e?.department !== dep) continue;
      const role = e.status === "active" ? loadRole(root, id) : null;
      const detail = e.status === "planned" ? `carried by ${e.carried_by}` : role ? `${role.mode}, ${role.tier}, ${role.access}` : "no profile yet";
      lines.push(`  ${id.padEnd(20)} ${e.status.padEnd(8)} ${detail}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
