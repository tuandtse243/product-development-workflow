import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { Diags } from "./diag.js";
import { loadRoster, parseRoleText, roleDir } from "./roles.js";

/**
 * The Artifact registry (docs/factory-architecture.md, section 6): every file a Role hands to the next one, with
 * its path inside `.aidw/`, its single owner and how it is checked.
 */

export const ARTIFACT_VALIDATORS = ["aidw validate", "aidw analyze", "aidw plan", "none"] as const;

export interface ArtifactEntry {
  path: string;
  owner: string;
  validate: string;
  /** which part of a shared file or folder this artifact is; required when two artifacts share a path */
  part?: string;
}

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export const artifactsFile = (root: string) => join(root, "artifacts.yaml");

/** The registry as written, or null when the file does not exist. Throws on invalid YAML. */
export function loadArtifacts(root: string): Record<string, ArtifactEntry> | null {
  const file = artifactsFile(root);
  if (!existsSync(file)) return null;
  const data = YAML.parse(readFileSync(file, "utf8")) as unknown;
  return isRecord(data) ? (data as Record<string, ArtifactEntry>) : {};
}

/** Validates the registry and the `reads` / `writes` of every Role profile against it. */
export function checkArtifacts(root: string): Diags {
  const d = new Diags();
  const af = "artifacts.yaml";
  let registry: Record<string, ArtifactEntry> | null;
  try {
    registry = loadArtifacts(root);
  } catch (e) {
    d.error(af, `not valid YAML: ${(e as Error).message}`);
    return d;
  }
  if (registry === null) {
    d.error(af, "not found");
    return d;
  }
  if (!existsSync(join(root, "roster.yaml"))) return d; // checkRoster reports the missing Roster
  const roster = loadRoster(root);
  const names = Object.keys(registry);
  if (names.length === 0) d.error(af, "the registry is empty");

  const byPath = new Map<string, string[]>();
  for (const name of names) {
    const e = registry[name];
    if (!NAME.test(name)) d.error(af, `artifact name "${name}" must be lower-case kebab-case`);
    if (!isRecord(e)) {
      d.error(af, `artifact ${name} is not a mapping`);
      continue;
    }
    if (typeof e.path !== "string" || !e.path.trim()) d.error(af, `artifact ${name}: path is required`);
    else if (e.path.startsWith("/") || e.path.includes("\\") || e.path.split("/").includes("..")) {
      d.error(af, `artifact ${name}: path "${e.path}" must stay inside .aidw/ (relative, no "..")`);
    } else byPath.set(e.path, [...(byPath.get(e.path) ?? []), name]);

    if (Array.isArray(e.owner)) d.error(af, `artifact ${name}: exactly one Role owns an artifact, not a list`);
    else if (typeof e.owner !== "string" || !e.owner) d.error(af, `artifact ${name}: owner is required`);
    else if (!(e.owner in roster.roles)) d.error(af, `artifact ${name}: owner "${e.owner}" is not in roster.yaml`);

    if (!(ARTIFACT_VALIDATORS as readonly unknown[]).includes(e.validate)) {
      d.error(af, `artifact ${name}: validate must be one of ${ARTIFACT_VALIDATORS.map((v) => `"${v}"`).join(", ")}`);
    }
    if (e.part !== undefined && (typeof e.part !== "string" || !e.part.trim())) d.error(af, `artifact ${name}: part must be a non-empty text`);
  }
  for (const [path, sharing] of byPath) {
    if (sharing.length < 2) continue;
    const parts = sharing.map((n) => registry[n]?.part);
    if (parts.some((p) => typeof p !== "string" || !p.trim())) d.error(af, `${sharing.join(", ")} share the path "${path}": each needs a "part" saying which part it is`);
    else if (new Set(parts).size !== parts.length) d.error(af, `${sharing.join(", ")} share the path "${path}" with the same part`);
  }

  const owned = (id: string) => names.filter((n) => registry[n]?.owner === id);
  for (const id of Object.keys(roster.roles)) {
    const file = `roles/${id}/role.md`;
    const path = join(roleDir(root, id), "role.md");
    if (!existsSync(path)) continue; // checkRoster reports a missing profile
    const header = parseRoleText(readFileSync(path, "utf8"))?.header;
    if (!header) continue; // and a broken one
    const lists: Record<"reads" | "writes", string[]> = { reads: [], writes: [] };
    for (const key of ["reads", "writes"] as const) {
      const raw = header[key];
      if (raw === undefined) continue;
      if (!Array.isArray(raw) || !raw.every((x) => typeof x === "string")) {
        d.error(file, `${key} must be a list of artifact names from artifacts.yaml`);
        continue;
      }
      lists[key] = raw as string[];
      for (const a of lists[key]) if (!(a in registry)) d.error(file, `${key}: "${a}" is not an artifact in artifacts.yaml`);
      if (new Set(lists[key]).size !== lists[key].length) d.error(file, `${key} lists an artifact twice`);
    }
    for (const a of lists.writes) {
      const owner = registry[a]?.owner;
      if (owner && owner !== id) d.error(file, `writes: "${a}" is owned by ${owner}; a Role writes only the artifacts it owns`);
    }
    for (const a of owned(id)) {
      if (!lists.writes.includes(a)) d.warn(file, `owns "${a}" but does not list it under writes`);
    }
  }
  return d;
}
