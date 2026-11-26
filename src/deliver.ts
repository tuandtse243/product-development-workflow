/**
 * `aidw deliver` (blueprint step 17, section 14): the Complete Delivery Package in
 * `.aidw/changes/<id>/delivery/`.
 *
 * The engine writes what it can derive deterministically from evidence (README with checklist and
 * deploy status, quality report, task table, decisions). The agent writes the prose a client needs
 * (handoff.md) and captures screenshots, then `aidw deliver --check` enforces the checklist.
 * Archive refuses a change whose delivery package does not pass.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLACEHOLDER } from "./analyze.js";
import { loadChange, stateOf, type Change } from "./change.js";
import { lastConverge } from "./converge.js";
import { shotsDir } from "./design.js";
import { Diags } from "./diag.js";
import { keepDiscardedWork } from "./draft.js";
import { git, isGitRepo } from "./git.js";
import { OpError } from "./ops.js";
import { readText, rel, walkFiles, type Paths } from "./project.js";
import { EXPECTED_LAYERS, RECOMMENDED_LAYERS, lastDeploy, loadQuality, parseQuality, qualityFile, readSummary } from "./quality.js";
import { loadTasks, type Evidence } from "./run.js";
import { touchesUi } from "./skills.js";
import type { Task } from "./tasks.js";
import { sections } from "./spec/parse.js";

export const HANDOFF_SECTIONS = ["Overview", "Run locally", "Environment", "Deploy", "Usage", "Known issues", "Merge danger", "Next steps"] as const;
const IMAGE = /\.(png|jpe?g|webp)$/i;

export const deliveryDir = (change: Change) => join(change.dir, "delivery");

const HANDOFF = (title: string) => `# Handoff: ${title}

## Overview

${PLACEHOLDER}: what was built, for whom, and what is out of scope (from the Analysis).

## Run locally

${PLACEHOLDER}: prerequisites and exact commands (install, local services, dev server, tests).

## Environment

${PLACEHOLDER}: every environment variable the app reads, what it is for and where its value comes from; point to .env.example. Variables only the tests use go under Run locally. Write "None" if the app reads none.

## Deploy

${PLACEHOLDER}: how this was deployed (target, URL) and how the client deploys to production themselves.

## Usage

${PLACEHOLDER}: the main flows for an end user, with the screenshots in screenshots/.

## Known issues

${PLACEHOLDER}: anything that does not work or was cut, failing or skipped checks, limitations. Write "None known" only if true.

## Merge danger

${PLACEHOLDER}: what could break when this merges: migrations (reversible, tried on a seeded copy), new or changed environment variables, dependency upgrades, breaking API changes, feature flags, data that must be moved. Write "None" only if true.

## Next steps

${PLACEHOLDER}: recommended follow-ups.
`;

const statusOf = (t: Task) => String(t.status ?? "pending");

/** I11, M4: the heading under which the handoff lists the checks that need a human (`manual:` on the tasks). */
export const CHECKS_FOR_YOU = "Checks for you";

/**
 * The checks the plan left to a human, one line each with its task: the run did not stop for them. A task not built
 * has nothing to check (the pull request lists it under "Not built and why").
 */
export function manualChecks(tasks: Task[]): string[] {
  return tasks.flatMap((t) =>
    statusOf(t) === "not_built" || !Array.isArray(t.manual)
      ? []
      : t.manual.filter((m): m is string => typeof m === "string" && m.trim() !== "").map((m) => `- [ ] ${t.id} ${cell(String(t.title ?? ""))}: ${m.trim()}`),
  );
}

/**
 * The handoff with `## Checks for you` holding exactly these lines: the section is replaced where it stands, or put
 * right after `## Overview` (at the end when there is none). With no check, an existing section says so.
 */
export function withChecksForYou(handoff: string, checks: string[]): string {
  const lines = handoff.replace(/\r\n?/g, "\n").split("\n");
  const h2 = (i: number) => /^##\s+(.+?)\s*#*\s*$/.exec(lines[i] ?? "")?.[1]?.trim().toLowerCase() ?? null;
  const next = (from: number) => {
    let fence = false;
    for (let i = from; i < lines.length; i++) {
      if (/^\s*(```|~~~)/.test(lines[i] ?? "")) fence = !fence;
      else if (!fence && h2(i) !== null) return i;
    }
    return lines.length;
  };
  const at = lines.findIndex((_, i) => h2(i) === CHECKS_FOR_YOU.toLowerCase());
  if (at < 0 && !checks.length) return handoff;
  const block = [
    `## ${CHECKS_FOR_YOU}`,
    "",
    ...(checks.length ? ["The plan left these checks to a person; the run did not stop for them. Tick each one you did.", "", ...checks] : ["None: every check of the plan ran automatically."]),
    "",
  ];
  if (at >= 0) lines.splice(at, next(at + 1) - at, ...block);
  else {
    const overview = lines.findIndex((_, i) => h2(i) === "overview");
    const where = overview >= 0 ? next(overview + 1) : lines.length;
    if (where === lines.length && lines.at(-1) !== "") lines.push("");
    lines.splice(where === lines.length ? lines.length : where, 0, ...block);
  }
  return lines.join("\n");
}

function readEvidence(change: Change, taskId: string): Evidence | null {
  const f = join(change.dir, "evidence", `${taskId}.json`);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as Evidence;
  } catch {
    return null;
  }
}

/**
 * The commit of a task, found by the trailers aidw writes (`Change: <id>`, `Task: <id>`), because the subject is a
 * Conventional Commits header and no longer starts with the task id. Both must match: task ids repeat across changes.
 */
export function commitOf(p: Paths, changeId: string, taskId: string): string {
  if (!isGitRepo(p.project)) return "";
  const r = git(p.project, ["log", "--format=%h", "-n", "1", "--all-match", "--grep", `^Change: ${changeId}$`, "--grep", `^Task: ${taskId}$`]);
  if (r.ok && r.out) return r.out;
  // A change run before the trailers existed: its commits start with the task id, and only on the change's own branch.
  const old = git(p.project, ["log", "--format=%h", "-n", "1", "--grep", `^${taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: `, `aidw/${changeId}`]);
  return old.ok ? old.out : "";
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function tasksMd(p: Paths, change: Change, tasks: Task[]): string {
  const rows = tasks.map((t) => {
    const ev = readEvidence(change, t.id);
    const reviews = (ev?.reviews ?? []).map((r) => r.verdict).join(", ") || "-";
    return `| ${t.id} | ${cell(String(t.title ?? ""))} | ${String(t.origin ?? "plan")} | ${statusOf(t)} | ${String(t.attempts ?? 0)} | ${reviews} | ${commitOf(p, change.id, t.id) || "-"} |`;
  });
  const outside = tasks.flatMap((t) => {
    const files = readEvidence(change, t.id)?.checkpoints.at(-1)?.outside_touches ?? [];
    return files.length ? [`- ${t.id}: ${files.map((f) => `\`${f}\``).join(", ")}`] : [];
  });
  return [
    `# Tasks: ${String(change.data.title ?? change.id)}`,
    "",
    "Origin `plan` = approved in the Analysis; `quality` = added to fix a failing quality layer; `integration` = added when a parallel wave did not work together; `converge` = added to cover a scenario.",
    "",
    "| Task | Title | Origin | Status | Attempts | Reviews | Commit |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "## Files changed outside a task's touches",
    "",
    ...(outside.length ? outside : ["None."]),
    "",
  ].join("\n");
}

function qualityMd(p: Paths, change: Change, tasks: Task[]): string {
  const text = readText(qualityFile(change)) ?? "";
  const { config } = parseQuality(text, "quality.yaml");
  const summary = readSummary(change);
  const conv = lastConverge(change);
  const deploy = lastDeploy(change);
  const out: string[] = [`# Quality report: ${String(change.data.title ?? change.id)}`, ""];

  out.push("## Layers", "", "| Layer | Status | Last run | Fix rounds | Commands | Review |", "|---|---|---|---|---|---|");
  for (const l of config?.layers ?? []) {
    const r = summary.layers[l.name];
    const rounds = tasks.filter((t) => t.origin === "quality" && t.layer === l.name).length;
    const review = l.review ? `${l.review} reviewer: ${r?.review ? `${r.review.verdict} (${r.review.at})` : "no verdict"}` : "-";
    const cmds = [...l.setup, ...l.run].map((c) => `\`${c}\``).join("<br>") || "(review only)";
    out.push(`| ${l.name} | ${r?.status ?? "not run"} | ${r?.at ?? "-"} | ${rounds} | ${cell(cmds)} | ${cell(review)} |`);
  }
  out.push("");
  const absent = (n: string) => !config?.layers.some((l) => l.name === n);
  const notRun = [
    ...EXPECTED_LAYERS.filter(absent).map((n) => `layer "${n}" was not in the approved quality profile (see the Analysis for why)`),
    ...RECOMMENDED_LAYERS.filter(absent).map((n) => `layer "${n}" was not in the approved quality profile: nothing here covers it`),
    ...Object.entries(summary.layers).flatMap(([n, r]) => (r.missing_reports?.length ? [`layer "${n}": declared report(s) missing: ${r.missing_reports.join(", ")}`] : [])),
  ];
  out.push("## Not covered", "", ...(notRun.length ? notRun.map((m) => `- ${m}`) : ["Nothing beyond the layers above."]), "");

  const fixes = tasks.filter((t) => t.origin === "quality");
  out.push("## Quality fix history", "");
  if (!fixes.length) out.push("No layer failed.");
  for (const t of fixes) {
    const first = String(t.problem ?? "").split("\n")[0] ?? "";
    out.push(`- ${t.id} (${statusOf(t)}, ${String(t.attempts ?? 0)} attempt(s)): ${first}`);
  }
  out.push("");

  out.push("## Scenarios (converge)", "");
  if (!conv) out.push("Converge did not run.");
  else {
    out.push(
      conv.mode === "junit"
        ? "Evidence: passing test cases in the layers' JUnit reports, on the delivered code."
        : "Evidence: **presence only** (no JUnit reports configured): a non-skipped test names each scenario and every layer passed. A test that names a scenario but asserts the wrong thing would not be caught here; the per-task reviewer checked the assertions.",
      "",
      "| Scenario | Status | Evidence |",
      "|---|---|---|",
      ...Object.entries(conv.scenarios).map(([s, r]) => `| \`${s}\` | ${r.status} | ${cell(r.where.slice(0, 3).join("; ") || "-")} |`),
    );
  }
  out.push("");

  const remark = (notes: string) => cell(notes.slice(notes.search(/non-blocking/i)).replace(/^non-blocking:?\s*/i, ""));
  const nonBlocking = [
    ...tasks.flatMap((t) =>
      (readEvidence(change, t.id)?.reviews ?? []).filter((r) => r.verdict === "pass" && /non-blocking/i.test(r.notes)).map((r) => `- ${t.id}: ${remark(r.notes)}`),
    ),
    ...Object.entries(summary.layers).flatMap(([n, r]) => (r.review?.verdict === "pass" && /non-blocking/i.test(r.review.notes) ? [`- layer ${n}: ${remark(r.review.notes)}`] : [])),
  ];
  out.push("## Reviewer remarks (non-blocking)", "", ...(nonBlocking.length ? nonBlocking : ["None recorded."]), "");

  out.push("## Deploy", "", deployLine(deploy), "");
  return out.join("\n");
}

function deployLine(d: ReturnType<typeof lastDeploy>): string {
  if (!d) return "Not deployed.";
  if (d.skipped) return `No deployment (target \`${d.target}\`).`;
  return d.ok ? `Preview: ${d.url} (smoke checks passed, ${d.at}).` : `Failed: ${d.error ?? "unknown"}.`;
}

function decisionsMd(p: Paths): string {
  const adrs = walkFiles(p.decisions)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const title = (readFileSync(f, "utf8").match(/^#\s+(.+)$/m)?.[1] ?? "").trim();
      return `- \`${rel(p, f)}\`${title ? `: ${title}` : ""}`;
    });
  return ["# Decisions", "", "Architecture decision records of the project (see also `## Architecture` in the Analysis).", "", ...(adrs.length ? adrs : ["No ADRs."]), ""].join("\n");
}

function screenshots(change: Change): string[] {
  const dir = join(deliveryDir(change), "screenshots");
  return existsSync(dir) ? readdirSync(dir).filter((f) => IMAGE.test(f)).sort() : [];
}

/**
 * Seeds an empty delivery/screenshots/ with the screenshots the reviewers judged: per UI task, its two newest
 * PNGs, desktop and light ones first. Saves a browser run in the sandbox; the agent may still replace them.
 */
function seedScreenshots(p: Paths, id: string, change: Change, tasks: Task[]): string[] {
  const target = join(deliveryDir(change), "screenshots");
  if (screenshots(change).length) return [];
  const copied: string[] = [];
  const rank = (f: string) => (/desktop/i.test(f) ? 0 : 2) + (/dark/i.test(f) ? 1 : 0);
  for (const t of tasks.filter((x) => touchesUi(x) && statusOf(x) === "done")) {
    const dir = shotsDir(p, id, String(t.id));
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir)
      .filter((f) => /\.png$/i.test(f))
      .map((f) => ({ f, at: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => rank(a.f) - rank(b.f) || b.at - a.at)
      .slice(0, 2);
    for (const { f } of files) {
      const name = `${String(copied.length + 1).padStart(2, "0")}-${String(t.id)}-${f}`;
      copyFileSync(join(dir, f), join(target, name));
      copied.push(name);
    }
  }
  return copied;
}

/** UI work was built: a UI task not built (ADR-0014) has no screen to show, and a draft pull request says so. */
function needsScreenshots(tasks: Task[]): boolean {
  return tasks.some((t) => touchesUi(t) && statusOf(t) === "done");
}

/** Checklist of blueprint section 14. Errors block archive. */
const SCRIPT_CALL = /\b(npm|pnpm|yarn|bun)\s+(?:run\s+)?([a-z0-9][\w:.-]*)/gi;
/** Package-manager subcommands that are not scripts (so `pnpm install` is never reported). */
const PM_BUILTINS = new Set(
  "install i add remove rm uninstall update up upgrade ci init create exec dlx x link unlink publish pack audit outdated why list ls config cache info view login logout version help store prune rebuild dedupe import patch patch-commit env setup global bin root run test start".split(" "),
);

/**
 * Commands in the project's README that call package scripts which do not exist, e.g. a README still saying
 * `pnpm e2e` after the script was renamed. `npm test` / `npm start` count as the test / start scripts.
 */
export function staleReadmeCommands(project: string): string[] {
  const readme = readText(join(project, "README.md"));
  const pkgText = readText(join(project, "package.json"));
  if (readme === null || pkgText === null) return [];
  let scripts: Record<string, unknown> = {};
  try {
    scripts = ((JSON.parse(pkgText) as { scripts?: Record<string, unknown> }).scripts ?? {}) as Record<string, unknown>;
  } catch {
    return [];
  }
  const out = new Set<string>();
  for (const m of readme.matchAll(SCRIPT_CALL)) {
    const pm = (m[1] as string).toLowerCase();
    const name = m[2] as string;
    const explicitRun = /\srun\s/.test(m[0]);
    if (!explicitRun && (name === "test" || name === "start")) {
      if (!(name in scripts)) out.add(m[0]);
      continue;
    }
    if (!explicitRun && (pm === "npm" || PM_BUILTINS.has(name))) continue; // `npm ci`, `pnpm install`, ...
    if (!(name in scripts)) out.add(m[0]);
  }
  return [...out];
}

export function checkDelivery(p: Paths, id: string): Diags {
  const change = loadChange(p, id);
  const d = new Diags();
  const dir = deliveryDir(change);
  const where = (f: string) => rel(p, join(dir, f));
  for (const f of ["README.md", "quality-report.md", "tasks.md", "decisions.md", "handoff.md"]) {
    if (!existsSync(join(dir, f))) d.error(where(f), "missing; run `aidw deliver`");
  }
  const handoff = readText(join(dir, "handoff.md"));
  if (handoff !== null) {
    const secs = sections(handoff);
    for (const name of HANDOFF_SECTIONS) {
      const s = secs.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!s) d.error(where("handoff.md"), `missing section "## ${name}"`);
      else if (!s.body.trim()) d.error(where("handoff.md"), `section "## ${name}" is empty`, s.line);
    }
    handoff.split(/\r?\n/).forEach((l, i) => {
      if (l.includes(PLACEHOLDER)) d.error(where("handoff.md"), `unresolved ${PLACEHOLDER} placeholder`, i + 1);
    });
    const checks = manualChecks(loadTasks(p, id).tasks);
    if (checks.length) {
      const body = secs.find((x) => x.name.toLowerCase() === CHECKS_FOR_YOU.toLowerCase())?.body;
      if (body === undefined) d.error(where("handoff.md"), `missing section "## ${CHECKS_FOR_YOU}" (the tasks' manual checks); run \`aidw deliver\``);
      else if (checks.some((c) => !body.includes(c.replace(/^- \[ \] /, "")))) d.error(where("handoff.md"), `"## ${CHECKS_FOR_YOU}" does not list every manual check of the tasks; run \`aidw deliver\``);
    }
    const env = secs.find((x) => x.name.toLowerCase() === "environment");
    if (env && !env.body.includes(PLACEHOLDER) && !/^\s*none\b/im.test(env.body) && !existsSync(join(p.project, ".env.example"))) {
      d.error(rel(p, join(p.project, ".env.example")), 'missing: the handoff lists environment variables, so ship a .env.example (or write "None" under ## Environment)');
    }
  }
  if (needsScreenshots(loadTasks(p, id).tasks) && screenshots(change).length === 0) {
    d.error(where("screenshots/"), "no screenshots (png, jpg, webp) of the main flows; this change has UI tasks");
  }
  if (!lastConverge(change)?.ok) d.error(where("quality-report.md"), "converge has not passed");
  if (!existsSync(join(p.project, "README.md"))) d.warn("README.md", "the project has no README: write one (what it is, run locally, tests, preview URL)");
  for (const c of staleReadmeCommands(p.project)) {
    d.error("README.md", `\`${c}\` calls a script that package.json does not define; update the README to the commands that work`);
  }
  return d;
}

export interface DeliverResult {
  dir: string;
  written: string[];
  created_handoff: boolean;
  screenshots: number;
  diags: Diags;
}

/** Writes the generated parts of the package (always regenerated) and a handoff skeleton (never overwritten). */
export function deliver(p: Paths, id: string, opts: { check?: boolean } = {}): DeliverResult {
  const change = loadChange(p, id);
  if (stateOf(change) !== "delivered") throw new OpError(`change "${id}" is "${String(change.data.state)}"; aidw deliver runs in state delivered`);
  loadQuality(p, change); // a broken quality.yaml is an error here, not a silent gap
  const dir = deliveryDir(change);
  const written: string[] = [];
  let createdHandoff = false;
  if (!opts.check) {
    const tasks = loadTasks(p, id).tasks;
    mkdirSync(join(dir, "screenshots"), { recursive: true });
    for (const f of seedScreenshots(p, id, change, tasks)) written.push(rel(p, join(dir, "screenshots", f)));
    // the work discarded from not-built tasks, from the machine-local .aidw/run/ into the package (src/draft.ts)
    written.push(...keepDiscardedWork(p, change, tasks));
    const write = (name: string, text: string) => {
      writeFileSync(join(dir, name), text);
      written.push(rel(p, join(dir, name)));
    };
    write("quality-report.md", qualityMd(p, change, tasks));
    write("tasks.md", tasksMd(p, change, tasks));
    write("decisions.md", decisionsMd(p));
    if (!existsSync(join(dir, "handoff.md"))) {
      writeFileSync(join(dir, "handoff.md"), HANDOFF(String(change.data.title ?? id)));
      createdHandoff = true;
    }
    // I11, M4: the checks that need a human, regenerated in the handoff on every run; the rest of it is the agent's
    const handoff = readFileSync(join(dir, "handoff.md"), "utf8");
    const withChecks = withChecksForYou(handoff, manualChecks(tasks));
    if (withChecks !== handoff) {
      writeFileSync(join(dir, "handoff.md"), withChecks);
      if (!createdHandoff) written.push(rel(p, join(dir, "handoff.md")));
    }
    write("README.md", readmeMd(p, change, tasks));
  }
  return { dir: rel(p, dir), written, created_handoff: createdHandoff, screenshots: screenshots(change).length, diags: checkDelivery(p, id) };
}

function readmeMd(p: Paths, change: Change, tasks: Task[]): string {
  const deploy = lastDeploy(change);
  const shots = screenshots(change);
  const done = tasks.filter((t) => statusOf(t) === "done").length;
  const summary = readSummary(change);
  const layers = Object.entries(summary.layers).map(([n, r]) => `${n} ${r.status}`).join(", ") || "none";
  const conv = lastConverge(change);
  const env = existsSync(join(p.project, ".env.example"));
  const checks = manualChecks(tasks).length;
  return [
    `# Delivery: ${String(change.data.title ?? change.id)}`,
    "",
    `Change \`${change.id}\` · ${done}/${tasks.length} tasks done · quality: ${layers} · scenarios: ${conv ? `${Object.values(conv.scenarios).filter((r) => r.status === "pass").length}/${Object.keys(conv.scenarios).length} passing (${conv.mode})` : "not converged"}`,
    "",
    "## Deploy",
    "",
    deployLine(deploy),
    "",
    "## Contents",
    "",
    `- [handoff.md](handoff.md): overview, ${checks ? `checks for you (${checks}), ` : ""}run locally, environment, deploy, usage, known issues, next steps`,
    "- [quality-report.md](quality-report.md): every layer with evidence, what failed and what was not covered",
    "- [tasks.md](tasks.md): plan and task status, attempts, reviews, commits",
    "- [decisions.md](decisions.md): architecture decision records",
    `- [screenshots/](screenshots/): ${shots.length ? shots.join(", ") : "none"}`,
    "- [../analysis.md](../analysis.md): the approved Analysis (scope, stack, design, plan, permissions, risks)",
    `- \`.env.example\` at the project root: ${env ? "yes" : "no"}`,
    "",
    "Evidence behind every line: `../evidence/` (per task, per quality layer, converge, deploy).",
    "",
  ].join("\n");
}

