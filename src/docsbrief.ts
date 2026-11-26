/**
 * The Docs Brief store (ADR-0016; R1, R3, R9, Q-R3): what the official documentation says about one library or
 * service at one version on one topic, written by the Research Role with its `docs-research` Skill and reused by
 * later Changes.
 *
 *   .aidw/research/docs/<lib>@<major.minor>-<topic>.md
 *
 * A brief opens with front matter that records what it holds for and when it was written:
 *
 *   ---
 *   lib: next                 the package or service name as the project names it (`@scope/name` included)
 *   version: 15.1.3           the installed version the brief was written for (quote it: "15.10" stays 15.10)
 *   topic: caching
 *   date: 2026-11-20          the day it was written (YYYY-MM-DD)
 *   ---
 *
 * and has the sections Question, Answer, Evidence, Pitfalls and Not found. It is reused while the installed version
 * is on the same line and the brief is at most 90 days old. The line is major.minor, with two narrowings: under
 * 0.0.x every patch may break, so only the same patch matches; a prerelease matches only the exact same version.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

export const DOCS_BRIEF_DIR = "research/docs";
export const DOCS_BRIEF_MAX_AGE_DAYS = 90;
export const DOCS_BRIEF_SECTIONS = ["Question", "Answer", "Evidence", "Pitfalls", "Not found"] as const;

export interface Version {
  major: number;
  minor: number;
  patch: number | null;
  prerelease: string | null;
}

/** An installed version or a range's lower bound (`^15.1.3`, `~0.4`, `v2.10.0`), or null when it names no minor. */
export function parseVersion(raw: string): Version | null {
  const m = /^\s*(?:>=|[\^~=v])*\s*(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/.exec(raw);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: m[3] === undefined ? null : Number(m[3]), prerelease: m[4] ?? null };
}

const mustParse = (raw: string): Version => {
  const v = parseVersion(raw);
  if (!v) throw new Error(`version "${raw}" names no major.minor (write the installed version, e.g. 15.1.3)`);
  return v;
};

/** Whether a brief written for `written` holds for `installed` (see the module comment). */
export function sameVersionLine(written: string, installed: string): boolean {
  const a = parseVersion(written);
  const b = parseVersion(installed);
  if (!a || !b) return false;
  if (a.major !== b.major || a.minor !== b.minor) return false;
  if (a.prerelease !== null || b.prerelease !== null) return a.patch === b.patch && a.prerelease === b.prerelease;
  if (a.major === 0 && a.minor === 0) return a.patch === b.patch;
  return true;
}

/** A package name as a file name: lower case, `@scope/name` as `scope__name`. */
export function libSlug(lib: string): string {
  const s = lib.trim().toLowerCase().replace(/^@/, "").replace("/", "__");
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(s) || s.includes("..")) throw new Error(`library "${lib}" cannot be written as a file name`);
  return s;
}

/** A topic as a file name: lower-case words joined by dashes. */
export function topicSlug(topic: string): string {
  const s = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s) throw new Error(`topic "${topic}" has no letters or digits`);
  return s;
}

export interface DocsRef {
  lib: string;
  version: string;
  topic: string;
}

/** A task's `docs:` entry, `<lib>@<version> <topic>` (R8); the topic may have several words. */
export function parseDocsRef(entry: string): DocsRef {
  const m = /^\s*(@?[^@\s]+)@(\S+)\s+(\S[\s\S]*?)\s*$/.exec(entry);
  if (!m) throw new Error(`"${entry}" is not <lib>@<version> <topic> (e.g. next@15.1.3 caching)`);
  return { lib: m[1]!, version: m[2]!, topic: m[3]! };
}

/** The file name of the brief for this library, version and topic. Throws when one of them cannot be written. */
export function docsBriefName(lib: string, version: string, topic: string): string {
  const v = mustParse(version);
  return `${libSlug(lib)}@${v.major}.${v.minor}-${topicSlug(topic)}.md`;
}

/** The absolute path of the brief inside `.aidw/` (`aidw` is the project's `.aidw` directory). */
export const docsBriefPath = (aidw: string, lib: string, version: string, topic: string): string =>
  join(aidw, ...DOCS_BRIEF_DIR.split("/"), docsBriefName(lib, version, topic));

export type DocsBriefStatus = "fresh" | "stale" | "missing" | "invalid";

export interface DocsBriefCheck {
  status: DocsBriefStatus;
  /** absolute path, where the brief is or must be written */
  path: string;
  /** the same path from the project root (`.aidw/research/docs/...`) */
  rel: string;
  reasons: string[];
  /** what the brief's front matter records, when it could be read */
  brief?: { lib: string; version: string; topic: string; date: string; ageDays: number | null };
}

const DAY = 86_400_000;

/** The day a `YYYY-MM-DD` text names, at 00:00 UTC, or null when it is not a calendar day. */
function calendarDay(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).toISOString().slice(0, 10) === text.trim() ? t : null;
}

/** Front matter (every value read as text) and the `## ` headings of a brief. */
export function parseDocsBrief(text: string): { meta: Record<string, string>; headings: string[] } {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  let meta: Record<string, string> = {};
  if (fm) {
    try {
      const parsed = YAML.parse(fm[1]!, { schema: "failsafe" }) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        meta = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Record<string, string>;
      }
    } catch {
      meta = {};
    }
  }
  const body = fm ? fm[2]! : text;
  const headings = [...body.matchAll(/^## +(.+?)\s*$/gm)].map((h) => h[1]!);
  return { meta, headings };
}

/**
 * Whether a fresh Docs Brief exists for this library, installed version and topic (R9): `fresh` may be reused,
 * `missing` and `stale` must be written (to `path`), `invalid` must be rewritten. `today` is for tests.
 */
export function checkDocsBrief(aidw: string, ref: DocsRef, today: Date = new Date()): DocsBriefCheck {
  const path = docsBriefPath(aidw, ref.lib, ref.version, ref.topic);
  const rel = [".aidw", DOCS_BRIEF_DIR, docsBriefName(ref.lib, ref.version, ref.topic)].join("/");
  if (!existsSync(path)) return { status: "missing", path, rel, reasons: [`no Docs Brief for ${ref.lib}@${ref.version} on ${ref.topic}`] };

  const { meta, headings } = parseDocsBrief(readFileSync(path, "utf8"));
  const invalid: string[] = [];
  for (const k of ["lib", "version", "topic", "date"]) if (!meta[k]?.trim()) invalid.push(`front matter has no ${k}`);
  if (meta.lib?.trim() && meta.lib.trim().toLowerCase() !== ref.lib.trim().toLowerCase()) invalid.push(`written for library "${meta.lib}", not "${ref.lib}"`);
  if (meta.topic?.trim()) {
    let same = false;
    try {
      same = topicSlug(meta.topic) === topicSlug(ref.topic);
    } catch {
      same = false;
    }
    if (!same) invalid.push(`written on topic "${meta.topic}", not "${ref.topic}"`);
  }
  if (meta.version?.trim()) {
    const v = parseVersion(meta.version);
    const want = mustParse(ref.version);
    if (!v) invalid.push(`version "${meta.version}" names no major.minor`);
    else if (v.major !== want.major || v.minor !== want.minor) invalid.push(`version ${meta.version} does not belong in a file for ${want.major}.${want.minor}`);
  }
  let ageDays: number | null = null;
  if (meta.date?.trim()) {
    const day = calendarDay(meta.date);
    if (day === null) invalid.push(`date "${meta.date}" is not a calendar day (YYYY-MM-DD)`);
    else {
      const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
      ageDays = Math.round((now - day) / DAY);
      if (ageDays < 0) invalid.push(`date ${meta.date} lies in the future`);
    }
  }
  for (const s of DOCS_BRIEF_SECTIONS) if (!headings.includes(s)) invalid.push(`no "## ${s}" section`);

  const brief = { lib: meta.lib ?? "", version: meta.version ?? "", topic: meta.topic ?? "", date: meta.date ?? "", ageDays };
  if (invalid.length) return { status: "invalid", path, rel, reasons: invalid, brief };

  const stale: string[] = [];
  if (!sameVersionLine(meta.version!, ref.version)) stale.push(`written for ${meta.version}, installed ${ref.version}`);
  if (ageDays !== null && ageDays > DOCS_BRIEF_MAX_AGE_DAYS) stale.push(`${ageDays} days old (at most ${DOCS_BRIEF_MAX_AGE_DAYS})`);
  if (stale.length) return { status: "stale", path, rel, reasons: stale, brief };
  return { status: "fresh", path, rel, reasons: [`written for ${meta.version}, ${ageDays} days old`], brief };
}
