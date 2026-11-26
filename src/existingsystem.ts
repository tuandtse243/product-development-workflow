/**
 * The Existing System Report of a brownfield Change (ADR-0016; I1, Q1, Q3, M1, M2, M10 of the rpi upgrades).
 *
 * Before the interview the orchestrator writes 2 to 7 neutral questions about today's code, in groups, to
 * `existing-system/questions.md`. One Research Agent per group answers its group in `existing-system/part-<n>.md`;
 * one more merges the parts into `existing-system.md` (Summary first, questions no part answered under "Not
 * answered"). A `bugfix`, or a `Size: small` Change, asks at most 3 questions in one group, and its one Agent writes
 * the report directly. `## Existing system` in analysis.md carries the report's Summary and names the file.
 * Greenfield skips all of it. `aidw analyze` checks the shape of what is on disk, for a Change created with
 * `analysis_template: 2` or later, so older Changes are not judged again.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Diags } from "./diag.js";
import { sections, toLines } from "./spec/parse.js";
import { EXISTING_SYSTEM_FILE } from "./beforeafter.js";

export const EXISTING_SYSTEM_DIR = "existing-system";
export const QUESTIONS_FILE = `${EXISTING_SYSTEM_DIR}/questions.md`;
export const partFile = (n: number) => `${EXISTING_SYSTEM_DIR}/part-${n}.md`;
/** How many questions a report asks: 2 to 7, or at most 3 in one group for a `bugfix` or a `Size: small` Change. */
export const QUESTIONS = { min: 2, max: 7, smallMax: 3 } as const;
/** The sections of the merged report that `aidw analyze` requires. */
export const REPORT_SECTIONS = ["Summary", "Not answered"] as const;

export interface QuestionGroup {
  title: string;
  line: number;
  questions: string[];
}

/** A question is a numbered line at column 0; an indented numbered line is a sub-list inside a question. */
const QUESTION = /^\d+[.)]\s+(\S.*)$/;

/**
 * The groups of a questions file: each `## ` heading opens a group, each numbered line (`1. ...`) is a question.
 * Numbered lines before the first heading form one untitled group.
 */
export function questionGroups(text: string): QuestionGroup[] {
  const out: QuestionGroup[] = [];
  let cur: QuestionGroup | null = null;
  for (const l of toLines(text)) {
    if (l.fenced) continue;
    const h = /^##\s+(.*?)\s*#*\s*$/.exec(l.text);
    if (h) {
      cur = { title: (h[1] as string).trim(), line: l.no, questions: [] };
      out.push(cur);
      continue;
    }
    const q = QUESTION.exec(l.text);
    if (!q) continue;
    if (!cur) {
      cur = { title: "", line: l.no, questions: [] };
      out.push(cur);
    }
    cur.questions.push((q[1] as string).trim());
  }
  return out.filter((g) => g.questions.length > 0);
}

export interface ExistingSystemOpts {
  /** the Change's folder on disk */
  dir: string;
  /** the Change's folder as shown in messages (`.aidw/changes/<id>`) */
  shown: string;
  /** analysis.md as shown in messages */
  analysisFile: string;
  /** the Workflow is `bugfix`: at most 3 questions in one group, an error otherwise */
  bugfix: boolean;
  /** the Analysis says `Size: small`: the same limit, a warning (the size is confirmed after the questions are asked) */
  small: boolean;
}

/** The checks `aidw analyze` runs on a brownfield Change that owes the report. */
export function checkExistingSystem(analysis: string, o: ExistingSystemOpts, d: Diags): void {
  const qShown = `${o.shown}/${QUESTIONS_FILE}`;
  const rShown = `${o.shown}/${EXISTING_SYSTEM_FILE}`;
  const qPath = join(o.dir, ...QUESTIONS_FILE.split("/"));
  if (!existsSync(qPath)) {
    d.error(qShown, `brownfield Change: missing the questions of the Existing System Report (${QUESTIONS.min} to ${QUESTIONS.max} neutral questions about today's code, in groups; /aidw:start step 1b)`);
  } else {
    const groups = questionGroups(readFileSync(qPath, "utf8"));
    const count = groups.reduce((n, g) => n + g.questions.length, 0);
    const small = `${QUESTIONS.smallMax} question(s) in one group, answered by one Agent`;
    if (count === 0) d.error(qShown, 'no questions: write each as a numbered line ("1. ...") under a "## " group heading');
    else if (o.bugfix && (count > QUESTIONS.smallMax || groups.length > 1)) {
      d.error(qShown, `a bugfix asks at most ${small} (${count} in ${groups.length} group(s))`);
    } else if (!o.bugfix && o.small && count < QUESTIONS.min) {
      d.error(qShown, `${count} question(s): a Size: small Change that is not a bugfix still writes ${QUESTIONS.min} to ${QUESTIONS.max} neutral questions about today's code (Q3)`);
    } else if (!o.bugfix && (count < QUESTIONS.min || count > QUESTIONS.max)) {
      d.error(qShown, `${count} question(s): write ${QUESTIONS.min} to ${QUESTIONS.max} neutral questions about today's code`);
    } else if (o.small && (count > QUESTIONS.smallMax || groups.length > 1)) {
      d.warn(qShown, `Size: small normally asks at most ${small} (${count} in ${groups.length} group(s))`);
    }
    // Several groups: one Research Agent per group wrote its part before the merge.
    if (groups.length > 1) {
      groups.forEach((g, i) => {
        if (!existsSync(join(o.dir, ...partFile(i + 1).split("/")))) {
          d.error(qShown, `${g.title ? `"## ${g.title}"` : `group ${i + 1}`} has no part: its Research Agent writes ${o.shown}/${partFile(i + 1)}`, g.line);
        }
      });
    }
  }

  const rPath = join(o.dir, EXISTING_SYSTEM_FILE);
  if (!existsSync(rPath)) d.error(rShown, "brownfield Change: missing the Existing System Report (the merging Research Agent writes it; /aidw:start step 1b)");
  else {
    const found = sections(readFileSync(rPath, "utf8"));
    for (const name of REPORT_SECTIONS) {
      const s = found.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!s) d.error(rShown, `missing section "## ${name}"${name === "Not answered" ? ' (the questions no part answered, or "None")' : ""}`);
      else if (!s.body.trim()) d.error(rShown, `section "## ${name}" is empty`, s.line);
    }
  }

  const existing = sections(analysis).find((s) => s.name.toLowerCase() === "existing system");
  if (existing?.body && !existing.body.includes(EXISTING_SYSTEM_FILE)) {
    d.error(o.analysisFile, `"## Existing system" carries the Summary of the Existing System Report: name ${EXISTING_SYSTEM_FILE}`, existing.line);
  }
}
