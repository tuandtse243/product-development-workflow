/**
 * Guard against making checks pass by weakening them (ADR-0006). It reads what a task changed since its base commit
 * and reports deleted, skipped or focused tests, and suppressions of the type checker or the linter. Only lines the
 * task added are read, so a brownfield project's existing suppressions are never held against the task.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { git } from "./git.js";

export type TamperKind = "deleted-test" | "skipped-test" | "focused-test" | "suppression";

export interface TamperFinding {
  kind: TamperKind;
  file: string;
  line?: number;
  text?: string;
}

export interface TamperEvidence {
  /** these fail the checkpoint */
  blocked: TamperFinding[];
  /** suppressions that state a reason on the same line: the reviewer decides whether the reason holds */
  justified: TamperFinding[];
  /** stored expected output (snapshots) that existed before and was rewritten or removed: the reviewer checks the new one is right */
  snapshots?: string[];
}

const CODE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|py)$/i;
const MAX_FILE = 1024 * 1024;

const SNAPSHOT = /(?:^|\/)__snapshots__\/|\.snap$|-snapshots\/[^/]+\.(?:png|txt)$|\.ambr$/;

const SKIPPED = /\.(?:skip|fixme)\s*\(|\b(?:xit|xtest|xdescribe)\s*\(|@(?:pytest\.mark\.skip|unittest\.skip)|\bpytest\.skip\s*\(/;
const FOCUSED = /\.only\s*\(|\b(?:fit|fdescribe)\s*\(/;
/** A directive that switches a check off, and the comment text that follows it. */
const DIRECTIVE = /(?:eslint-disable(?:-next-line|-line)?|oxlint-disable(?:-next-line|-line)?|biome-ignore|@ts-ignore|@ts-nocheck|@ts-expect-error|#\s*noqa|#\s*type:\s*ignore|#\s*pyright:\s*ignore)(.*)$/;
const AS_ANY = /\bas\s+any\b(.*)$/;

/** Words left once rule names, codes and punctuation are taken out: a reason needs at least two. */
function hasReason(rest: string, needsComment: boolean): boolean {
  let text = rest;
  if (needsComment) {
    const at = text.search(/\/\/|\/\*/);
    if (at < 0) return false;
    text = text.slice(at);
  }
  const words = text
    .replace(/\*\/|-->|\{\/\*|\*\/\}/g, " ")
    .split(/[\s,:()[\]]+/)
    .filter((w) => /^[A-Za-z][A-Za-z']+$/.test(w) && !/^[A-Z]+\d+$/.test(w));
  return words.length >= 2;
}

/** Added lines of `file` since `base`, with their line numbers; the whole file when it is new. */
export function addedLines(dir: string, base: string | null, file: string): { line: number; text: string }[] {
  const full = join(dir, file);
  if (!existsSync(full) || statSync(full).size > MAX_FILE) return [];
  const whole = () => readFileSync(full, "utf8").split(/\r?\n/).map((text, i) => ({ line: i + 1, text }));
  if (!base || !git(dir, ["cat-file", "-e", `${base}:${file}`]).ok) return whole();
  const diff = git(dir, ["diff", "-U0", "--no-color", base, "--", file]);
  if (!diff.ok) return whole();
  const out: { line: number; text: string }[] = [];
  let n = 0;
  for (const l of diff.out.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l);
    if (hunk) n = Number(hunk[1]);
    else if (l.startsWith("+") && !l.startsWith("+++")) out.push({ line: n++, text: l.slice(1) });
  }
  return out;
}

/** Titles of the tests in a file: the quoted first argument of test(), it() and describe(). */
const testTitles = (text: string): string[] => [...text.matchAll(/\b(?:test|it|describe)(?:\.\w+)*\s*\(\s*(["'`])((?:\\.|(?!\1).)+)\1/g)].map((m) => m[2] as string);

/**
 * Test files that existed at `base` and are gone now. A move is not a deletion: git pairs a rename only when the new
 * file is tracked, and a task's new file usually is not yet (trial 4B), so a file also counts as moved when another
 * changed file has the same content, or holds every one of its test titles.
 */
function deletedTests(dir: string, base: string | null, changed: string[], isTest: (f: string) => boolean): string[] {
  if (!base) return [];
  const r = git(dir, ["diff", "--name-status", "-M", base]);
  if (!r.ok) return [];
  const gone = r.out
    .split("\n")
    .map((l) => l.split("\t"))
    .filter(([status, file]) => status === "D" && file && isTest(file) && !existsSync(join(dir, file)))
    .map(([, file]) => file as string);
  if (!gone.length) return [];
  const text = (f: string): string | null => {
    try {
      return statSync(join(dir, f)).size > MAX_FILE ? null : readFileSync(join(dir, f), "utf8");
    } catch {
      return null;
    }
  };
  const elsewhere = changed.filter((f) => isTest(f) && existsSync(join(dir, f))).map((f) => (text(f) ?? "").trim()); // git output is trimmed, so compare trimmed
  const together = elsewhere.join("\n");
  return gone.filter((file) => {
    const old = git(dir, ["show", `${base}:${file}`]);
    if (!old.ok) return true;
    if (elsewhere.some((t) => t === old.out.trim())) return false;
    const titles = testTitles(old.out);
    return !(titles.length > 0 && titles.every((t) => together.includes(t)));
  });
}

export function tamperEvidence(
  dir: string,
  base: string | null,
  changed: string[] | null,
  opts: { isTest: (f: string) => boolean; removesTests?: boolean },
): TamperEvidence | null {
  if (changed === null) return null; // not a git repository: nothing to compare with
  const blocked: TamperFinding[] = [];
  const justified: TamperFinding[] = [];
  if (!opts.removesTests) for (const file of deletedTests(dir, base, changed, opts.isTest)) blocked.push({ kind: "deleted-test", file });
  for (const file of changed) {
    if (!CODE_FILE.test(file)) continue;
    const test = opts.isTest(file);
    for (const { line, text } of addedLines(dir, base, file)) {
      const at = { file, line, text: text.trim().slice(0, 160) };
      if (test && FOCUSED.test(text)) blocked.push({ kind: "focused-test", ...at });
      if (test && SKIPPED.test(text)) blocked.push({ kind: "skipped-test", ...at });
      const directive = DIRECTIVE.exec(text);
      const cast = directive ? null : AS_ANY.exec(text);
      if (!directive && !cast) continue;
      const ok = directive ? hasReason(directive[1] ?? "", false) : hasReason(cast?.[1] ?? "", true);
      (ok ? justified : blocked).push({ kind: "suppression", ...at });
    }
  }
  const snapshots = base ? changed.filter((f) => SNAPSHOT.test(f) && git(dir, ["cat-file", "-e", `${base}:${f}`]).ok) : [];
  return { blocked, justified, ...(snapshots.length ? { snapshots } : {}) };
}

const LABEL: Record<TamperKind, string> = {
  "deleted-test": "test file deleted",
  "skipped-test": "test skipped",
  "focused-test": "test focused with .only",
  suppression: "check switched off without a reason on the same line",
};

/** One line per kind for the checkpoint's problem list. */
export function tamperProblems(e: TamperEvidence | null): string[] {
  if (!e) return [];
  const out: string[] = [];
  for (const kind of Object.keys(LABEL) as TamperKind[]) {
    const found = e.blocked.filter((f) => f.kind === kind);
    if (!found.length) continue;
    const where = found.slice(0, 5).map((f) => (f.line ? `${f.file}:${f.line}` : f.file));
    out.push(`${LABEL[kind]}: ${where.join(", ")}${found.length > 5 ? `, and ${found.length - 5} more` : ""}`);
  }
  return out;
}
