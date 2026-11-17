/**
 * Guard: install safety for the packages a task adds (ADR-0006). An Agent can name a package that does not exist,
 * pick a version published an hour ago, or add one with a known vulnerability. For every package the task added to
 * the manifest, the version that was installed is looked up on deps.dev (one small request: it answers whether the
 * version exists, when it was published and which advisories apply). Only what the task added is checked, so the
 * project's older dependencies are never held against it. When the lookup cannot run (no network, a sandbox), the
 * result is `unproven` and the reviewer is told; it never fails the task for that.
 *
 * This runs after the install, so it does not stop an install script: the stack pack sets the package manager's own
 * release-age setting for that. The Guard is the part that also works on a project aidw did not set up.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { git } from "./git.js";

export type Ecosystem = "npm" | "pypi";

export interface AddedPackage {
  ecosystem: Ecosystem;
  name: string;
  /** exact version, or null when none could be determined */
  version: string | null;
  manifest: string;
}

export interface PackageFinding {
  name: string;
  version: string | null;
  problem: "not-found" | "too-new" | "vulnerable";
  detail: string;
}

export interface PackageEvidence {
  checked: string[];
  /** these fail the checkpoint */
  blocked: PackageFinding[];
  /** packages that could not be looked up, with the reason */
  unproven: string[];
}

export interface LookupResult {
  status: "found" | "not-found" | "error";
  publishedAt?: string;
  advisories?: string[];
  error?: string;
}
export type Lookup = (ecosystem: Ecosystem, name: string, version: string) => LookupResult;

/** deps.dev, through curl so a proxy from the environment applies. */
export const depsDevLookup: Lookup = (ecosystem, name, version) => {
  const url = `https://api.deps.dev/v3/systems/${ecosystem}/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`;
  const r = spawnSync("curl", ["-sS", "--max-time", "10", "-A", "aidw", "-w", "\n%{http_code}", url], { encoding: "utf8" });
  if (r.status !== 0) return { status: "error", error: (r.stderr ?? "").trim().split("\n").pop() || "curl failed" };
  const at = r.stdout.lastIndexOf("\n");
  const code = r.stdout.slice(at + 1).trim();
  if (code === "404") return { status: "not-found" };
  if (code !== "200") return { status: "error", error: `deps.dev answered ${code}` };
  try {
    const d = JSON.parse(r.stdout.slice(0, at)) as { publishedAt?: string; advisoryKeys?: { id?: string }[] };
    return { status: "found", publishedAt: d.publishedAt, advisories: (d.advisoryKeys ?? []).map((a) => String(a.id ?? "")).filter(Boolean) };
  } catch {
    return { status: "error", error: "deps.dev sent an unreadable answer" };
  }
};

let lookup: Lookup = depsDevLookup;
/** Replaces the registry lookup (tests). */
export const usePackageLookup = (l: Lookup): void => {
  lookup = l;
};

/** Whether the lookup the Guard uses can answer from here (`aidw doctor`). Any answer counts, a 404 included. */
export function packageLookupReachable(): { ok: boolean; error?: string } {
  const r = lookup("npm", "left-pad", "1.3.0");
  return r.status === "error" ? { ok: false, error: r.error } : { ok: true };
}

const EXACT = /^\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/;
const atBase = (dir: string, base: string, file: string): string | null => {
  const r = git(dir, ["show", `${base}:${file}`]);
  return r.ok ? r.out : null;
};

function npmDeps(text: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!text) return out;
  try {
    const pkg = JSON.parse(text) as Record<string, unknown>;
    for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
      const deps = pkg[key];
      if (deps && typeof deps === "object") for (const [n, v] of Object.entries(deps)) out.set(n, String(v));
    }
  } catch {
    // an unreadable manifest adds nothing
  }
  return out;
}

/** The version that is installed, looked for from the manifest's folder upward (workspaces hoist to the root). */
function installedNpmVersion(dir: string, manifest: string, name: string): string | null {
  for (let d = join(dir, dirname(manifest)); ; d = dirname(d)) {
    const f = join(d, "node_modules", name, "package.json");
    if (existsSync(f)) {
      try {
        const v = (JSON.parse(readFileSync(f, "utf8")) as { version?: unknown }).version;
        if (typeof v === "string") return v;
      } catch {
        // fall through to the spec
      }
    }
    if (d === dir || dirname(d) === d) return null;
  }
}

const REQUIREMENT = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(?:==\s*([A-Za-z0-9.!+*-]+))?/;
function pyRequirements(text: string | null): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const line of (text ?? "").split(/\r?\n/)) {
    if (!line.trim() || /^\s*(?:#|-)/.test(line)) continue;
    const m = REQUIREMENT.exec(line);
    if (m?.[1]) out.set(m[1].toLowerCase().replace(/[._]+/g, "-"), m[2] && !m[2].includes("*") ? m[2] : null);
  }
  return out;
}

/** `[[package]]` entries of a uv.lock: name -> version. */
function uvLock(text: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const block of (text ?? "").split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const version = /^version\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    if (name && version) out.set(name.toLowerCase(), version);
  }
  return out;
}

/** Packages the task added to a manifest since `base` (every package when the manifest is new). */
export function addedPackages(dir: string, base: string | null, changed: string[]): AddedPackage[] {
  const out: AddedPackage[] = [];
  const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : null);
  const before = (f: string) => (base ? atBase(dir, base, f) : null);
  for (const file of changed) {
    const name = file.split("/").pop() ?? "";
    if (name === "package.json" && !file.includes("node_modules/")) {
      const old = npmDeps(before(file));
      for (const [pkg, spec] of npmDeps(read(file))) {
        if (old.has(pkg) || /^(?:workspace:|file:|link:|git\+|https?:|npm:|catalog:)/.test(spec)) continue;
        out.push({ ecosystem: "npm", name: pkg, version: installedNpmVersion(dir, file, pkg) ?? (EXACT.test(spec) ? spec : null), manifest: file });
      }
    } else if (/^requirements(?:[-.][\w.-]+)?\.txt$/.test(name)) {
      const old = pyRequirements(before(file));
      for (const [pkg, version] of pyRequirements(read(file))) if (!old.has(pkg)) out.push({ ecosystem: "pypi", name: pkg, version, manifest: file });
    } else if (name === "uv.lock") {
      // Direct dependencies only: a package the lock gained and the pyproject next to it names.
      const project = read(join(dirname(file), "pyproject.toml").replace(/^\.\//, "")) ?? "";
      const old = uvLock(before(file));
      for (const [pkg, version] of uvLock(read(file))) {
        const named = new RegExp(`["']${pkg.replace(/[-_.]+/g, "[-_.]+")}(?![\\w.-])`, "i").test(project);
        if (!old.has(pkg) && named) out.push({ ecosystem: "pypi", name: pkg, version, manifest: file });
      }
    }
  }
  return out;
}

export const minReleaseAgeDays = (env: NodeJS.ProcessEnv = process.env): number => {
  const n = Number(env.AIDW_MIN_RELEASE_AGE_DAYS);
  return Number.isFinite(n) && n >= 0 && env.AIDW_MIN_RELEASE_AGE_DAYS !== undefined && env.AIDW_MIN_RELEASE_AGE_DAYS !== "" ? n : 3;
};

export function packageEvidence(
  dir: string,
  base: string | null,
  changed: string[] | null,
  opts: { env?: NodeJS.ProcessEnv; now?: number } = {},
): PackageEvidence | null {
  const env = opts.env ?? process.env;
  if (changed === null || env.AIDW_SKIP_INSTALL_CHECK === "1") return null;
  const added = addedPackages(dir, base, changed);
  if (!added.length) return null;
  const minDays = minReleaseAgeDays(env);
  const now = opts.now ?? Date.now();
  const ev: PackageEvidence = { checked: [], blocked: [], unproven: [] };
  let down = 0;
  for (const a of added) {
    const label = `${a.name}${a.version ? `@${a.version}` : ""}`;
    if (!a.version) {
      ev.unproven.push(`${label}: no exact version (not installed and not pinned in ${a.manifest})`);
      continue;
    }
    // After three failed lookups the service is unreachable from here: do not wait ten seconds for each remaining one.
    const r: LookupResult = down >= 3 ? { status: "error", error: "lookup skipped after earlier failures" } : lookup(a.ecosystem, a.name, a.version);
    if (r.status === "error") {
      down++;
      ev.unproven.push(`${label}: ${r.error ?? "lookup failed"}`);
      continue;
    }
    ev.checked.push(label);
    if (r.status === "not-found") {
      ev.blocked.push({ name: a.name, version: a.version, problem: "not-found", detail: "this version is not known to the public registry index: the name may be invented, or the version is hours old" });
      continue;
    }
    const age = r.publishedAt ? (now - Date.parse(r.publishedAt)) / 86_400_000 : Number.POSITIVE_INFINITY;
    if (age < minDays) ev.blocked.push({ name: a.name, version: a.version, problem: "too-new", detail: `published ${age.toFixed(1)} days ago; the minimum is ${minDays}` });
    if (r.advisories?.length) ev.blocked.push({ name: a.name, version: a.version, problem: "vulnerable", detail: `known advisories: ${r.advisories.slice(0, 4).join(", ")}${r.advisories.length > 4 ? `, and ${r.advisories.length - 4} more` : ""}` });
  }
  return ev;
}

export function packageProblems(e: PackageEvidence | null): string[] {
  return (e?.blocked ?? []).map((f) => `unsafe package ${f.name}@${f.version}: ${f.detail}`);
}
