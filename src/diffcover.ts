/**
 * Coverage of the lines a Change added, from an LCOV report (Vitest `reporter: ["lcov"]`, pytest-cov
 * `--cov-report=lcov`). A whole-project threshold punishes a Change for old untested code, or lets new untested code
 * hide behind old coverage; this counts only added lines that the report knows as executable.
 */
import { isAbsolute, relative, sep } from "node:path";
import { git } from "./git.js";
import { addedLines } from "./tamper.js";

/** file (as the report names it) -> executable line -> hit count */
export function parseLcov(text: string): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  let lines: Map<number, number> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith("SF:")) {
      const file = raw.slice(3).trim();
      lines = out.get(file) ?? new Map();
      out.set(file, lines);
    } else if (raw.startsWith("DA:") && lines) {
      const [n, hits] = raw.slice(3).split(",");
      const line = Number(n);
      if (Number.isInteger(line)) lines.set(line, Math.max(lines.get(line) ?? 0, Number(hits) || 0));
    } else if (raw === "end_of_record") lines = null;
  }
  return out;
}

export interface DiffCoverage {
  base: string;
  /** added lines the report counts as executable */
  total: number;
  covered: number;
  /** 100 when the Change added no executable line */
  percent: number;
  files: { file: string; total: number; covered: number; uncovered: number[] }[];
}

export function diffCoverage(dir: string, base: string, lcov: string): DiffCoverage {
  const root = git(dir, ["rev-parse", "--show-toplevel"]).out || dir;
  const files: DiffCoverage["files"] = [];
  for (const [name, lines] of parseLcov(lcov)) {
    const file = (isAbsolute(name) ? relative(root, name) : name).split(sep).join("/");
    if (file.startsWith("..")) continue;
    const added = addedLines(root, base, file).map((l) => l.line).filter((n) => lines.has(n));
    if (!added.length) continue;
    const uncovered = added.filter((n) => (lines.get(n) ?? 0) === 0);
    files.push({ file, total: added.length, covered: added.length - uncovered.length, uncovered });
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  const total = files.reduce((n, f) => n + f.total, 0);
  const covered = files.reduce((n, f) => n + f.covered, 0);
  return { base, total, covered, percent: total === 0 ? 100 : Math.round((covered / total) * 1000) / 10, files };
}

/** `main`, `master` or their remote: where the branch left the trunk. */
export function trunkBase(dir: string): string | null {
  for (const ref of ["origin/main", "main", "origin/master", "master"]) {
    const r = git(dir, ["merge-base", "HEAD", ref]);
    if (r.ok && r.out) return r.out;
  }
  return null;
}

const ranges = (nums: number[]): string => {
  const out: string[] = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (nums[j + 1] === (nums[j] as number) + 1) j++;
    out.push(i === j ? String(nums[i]) : `${nums[i]}-${nums[j]}`);
    i = j;
  }
  return out.join(", ");
};

export function coverageReport(c: DiffCoverage, min: number): string {
  const head = `coverage of added lines: ${c.percent}% (${c.covered} of ${c.total}), minimum ${min}%`;
  const gaps = c.files.filter((f) => f.uncovered.length).map((f) => `  ${f.file}: lines ${ranges(f.uncovered)} are not covered`);
  return [head, ...gaps].join("\n");
}
