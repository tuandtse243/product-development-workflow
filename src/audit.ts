import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadChange } from "./change.js";
import { answerOf } from "./decisions.js";
import { Diags } from "./diag.js";
import { readText, rel, type Paths } from "./project.js";
import { loadWorkflow, type Workflow } from "./workflow.js";

/**
 * The `audit` Workflow: read-only reviewers look at the current code through the lenses the Change decided on and each
 * writes its findings; the CLI assembles one report by severity. No code changes, no approval gate. The user then picks
 * findings, and each pick becomes the request of a new `bugfix` or `feature` Change.
 */
export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Finding {
  severity: Severity;
  lens: string;
  text: string;
}

export const lensFile = (p: Paths, lens: string) => join(p.run, `audit-${lens}.md`);
export const reportFile = (change: { dir: string }) => join(change.dir, "audit-report.md");

/** The lens -> Role map of the Workflow's review stage. */
export function lensRoles(w: Workflow): Record<string, string> {
  return w.stages.find((s) => s.lenses)?.lenses ?? {};
}

/** The lenses the Change decided on (`aidw decide audit-lenses`), or null while undecided. */
export function chosenLenses(p: Paths, id: string): string[] | null {
  return answerOf(loadChange(p, id), "audit-lenses");
}

/** `LENS: <lens>` on the first line, `## Findings` with `- [severity] where: what` bullets (or `None`), then `## Not covered`. */
export function parseLens(text: string, lens: string, file: string): { findings: Finding[]; notCovered: string[]; diags: Diags } {
  const d = new Diags();
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if ((lines[0] ?? "").trim() !== `LENS: ${lens}`) d.error(file, `the first line must be exactly "LENS: ${lens}"`);
  const section = (name: string): string[] | null => {
    const at = lines.findIndex((l) => l.trim().toLowerCase() === `## ${name}`);
    if (at < 0) return null;
    const rest = lines.slice(at + 1);
    const end = rest.findIndex((l) => /^##\s/.test(l));
    return (end < 0 ? rest : rest.slice(0, end)).map((l) => l.trim()).filter(Boolean);
  };
  const findings: Finding[] = [];
  const body = section("findings");
  if (!body) d.error(file, 'missing section "## Findings"');
  else if (!(body.length === 1 && /^none\.?$/i.test(body[0] as string))) {
    for (const l of body) {
      const m = /^- \[(critical|high|medium|low)\]\s+(\S.*)$/i.exec(l);
      if (m) findings.push({ severity: (m[1] as string).toLowerCase() as Severity, lens, text: (m[2] as string).trim() });
      else d.error(file, `"${l.slice(0, 60)}" must be "- [critical|high|medium|low] <where>: <problem>", or the section says None`);
    }
    if (!findings.length && !d.errors.length) d.error(file, '"## Findings" is empty: list findings or write None');
  }
  const notCovered = section("not covered");
  if (!notCovered) d.error(file, 'missing section "## Not covered" (what the review could not look at, or None)');
  return { findings, notCovered: (notCovered ?? []).filter((l) => !/^none\.?$/i.test(l)), diags: d };
}

/** The context packet of one lens reviewer. */
export function buildAuditBrief(p: Paths, id: string, lens: string, role: string): { path: string; text: string } {
  const change = loadChange(p, id);
  const intake = readText(join(change.dir, "intake.md")) ?? "";
  const out = lensFile(p, lens);
  const focus: Record<string, string> = {
    security: "authorization on every path, input handling, secrets, data access and exposure, dependencies with known problems",
    "code-quality": "correctness, error handling, duplication and needless complexity, tests that do not test, conventions of the constitution",
    ui: "compliance with the design tokens and direction, responsive layout, empty/loading/error states, accessibility",
  };
  const text = [
    `# Audit brief: ${lens} - ${String(change.data.title ?? id)}`,
    "",
    `Change \`${id}\` · lens \`${lens}\` · Role ${role}`,
    "",
    "You are an independent reviewer in a fresh context. You audit the code as it is today. You may read files and run read-only commands; you change nothing, and you do not fix what you find.",
    "",
    "## What to audit",
    "",
    `Focus: ${focus[lens] ?? lens}.`,
    "",
    "The request (scope of the audit):",
    "",
    "```markdown",
    intake.trim() || "(empty: audit the whole project)",
    "```",
    "",
    "Read first when they exist: `.aidw/constitution.md`, `.aidw/architecture/overview.md`, `.aidw/specs/`, `.aidw/design/`.",
    "",
    "## Answer",
    "",
    `**Write the whole answer to \`${out}\` with the Write tool** (the only file you may write), in this exact shape, then reply with just its first line:`,
    "",
    "```markdown",
    `LENS: ${lens}`,
    "## Findings",
    "- [critical|high|medium|low] <file or area>: <what is wrong, and why it matters>",
    "## Not covered",
    "- <what you could not look at, and why> (or None)",
    "```",
    "",
    "One bullet per finding, most serious first. Severity: critical = exploitable or data loss now; high = breaks a requirement or a real user flow; medium = wrong or fragile but contained; low = polish. Be concrete: a finding with no file or evidence is not a finding. Write `None` under Findings only if you found nothing.",
    "",
  ].join("\n");
  const dir = join(p.run, "briefs", id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `audit-${lens}.md`);
  writeFileSync(path, text);
  return { path, text };
}

export interface Report {
  path: string;
  findings: (Finding & { id: string })[];
  diags: Diags;
}

/** Assembles `audit-report.md` from the lens files of the decided lenses: findings by severity, numbered F-01... */
export function compileReport(p: Paths, id: string): Report {
  const change = loadChange(p, id);
  const d = new Diags();
  const lenses = chosenLenses(p, id);
  if (!lenses) {
    d.error(rel(p, join(change.dir, "decisions.yaml")), 'no lenses decided: run `aidw decide audit-lenses <lens,lens> --reason "..."`');
    return { path: reportFile(change), findings: [], diags: d };
  }
  const all: Finding[] = [];
  const notCovered: string[] = [];
  for (const lens of lenses) {
    const file = lensFile(p, lens);
    if (!existsSync(file)) {
      d.error(rel(p, file), `the "${lens}" review has not written its answer yet`);
      continue;
    }
    const parsed = parseLens(readFileSync(file, "utf8"), lens, rel(p, file));
    d.add(parsed.diags);
    all.push(...parsed.findings);
    notCovered.push(...parsed.notCovered.map((l) => `- [${lens}] ${l.replace(/^- /, "")}`));
  }
  if (d.errors.length) return { path: reportFile(change), findings: [], diags: d };
  const order = (s: Severity) => SEVERITIES.indexOf(s);
  const sorted = all.map((f, i) => ({ f, i })).sort((a, b) => order(a.f.severity) - order(b.f.severity) || a.i - b.i).map((x) => x.f);
  const findings = sorted.map((f, i) => ({ ...f, id: `F-${String(i + 1).padStart(2, "0")}` }));
  const counts = SEVERITIES.map((s) => `${findings.filter((f) => f.severity === s).length} ${s}`).join(", ");
  const text = [
    `# Audit report: ${String(change.data.title ?? id)}`,
    "",
    `Change \`${id}\` · lenses: ${lenses.join(", ")} · ${findings.length} finding(s): ${counts}`,
    "",
    "## Findings",
    "",
    ...(findings.length ? SEVERITIES.flatMap((s) => {
      const group = findings.filter((f) => f.severity === s);
      return group.length ? [`### ${s[0]!.toUpperCase()}${s.slice(1)}`, "", ...group.map((f) => `- ${f.id} [${f.lens}] ${f.text}`), ""] : [];
    }) : ["None.", ""]),
    "## Not covered",
    "",
    ...(notCovered.length ? notCovered : ["- None"]),
    "",
    "## Next",
    "",
    "Pick the findings to act on (`aidw audit picks <id> F-01,F-02`); each pick becomes the request of a new bugfix or feature change.",
    "",
  ].join("\n");
  writeFileSync(reportFile(change), text);
  return { path: reportFile(change), findings, diags: d };
}

/** The text of the picked findings, ready to be the request of a new Change. */
export function pickFindings(p: Paths, id: string, picks: string[]): { text: string; missing: string[] } {
  const report = readText(reportFile(loadChange(p, id))) ?? "";
  const byId = new Map<string, string>();
  for (const l of report.split("\n")) {
    const m = /^- (F-\d+) (\[.+)$/.exec(l);
    if (m) byId.set(m[1] as string, m[2] as string);
  }
  const missing = picks.filter((x) => !byId.has(x));
  const text = [`Act on these findings of the audit ${id}:`, "", ...picks.filter((x) => byId.has(x)).map((x) => `- ${x} ${byId.get(x)}`), ""].join("\n");
  return { text, missing };
}

/** `aidw transition <id> delivered` for an audit: every decided lens has a valid answer and the report is assembled. */
export function auditReady(p: Paths, id: string): string | null {
  const r = compileReport(p, id);
  if (r.diags.errors.length) return `"delivered" needs every audit lens answered: ${r.diags.errors[0]!.message}`;
  return null;
}

export const isAudit = (w: Workflow | null): boolean => !!w && w.stages.some((s) => s.lenses);
export { loadWorkflow };
