/**
 * Quality layers and deploy (slice S4, blueprint sections 11 and 15).
 *
 * `.aidw/changes/<id>/quality.yaml` is the machine-readable half of the Analysis sections
 * "Quality profile", "Deploy strategy" and "Permissions". It is part of the approved package
 * (hashed and frozen), so every command in it was approved by the user and runs without asking.
 *
 *   aidw verify   runs the layers in order; a failing layer becomes a fix task (origin: quality)
 *                 that goes through the normal implement -> checkpoint -> review loop
 *   aidw deploy   runs the approved preview deploy, then smoke checks against its URL
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { AGENTS, defaultTaskRole } from "./roles.js";
import { join } from "node:path";
import YAML from "yaml";
import { approvalStatus } from "./approval.js";
import { recordBaseline } from "./backstop.js";
import { loadChange, stateOf, type Change } from "./change.js";
import { Diags } from "./diag.js";
import { headCommit } from "./git.js";
import { OpError, transition } from "./ops.js";
import { firstMatch, isTier2Resource, TIER2_COMMANDS, TIER2_RESOURCES, ASK_COMMANDS, type Tier2Resource } from "./policy.js";
import { parseGrants, type Grants } from "./grants.js";
import { readText, rel, type Paths } from "./project.js";
import { buildLayerBrief } from "./layers.js";
import { pickGroup } from "./stages.js";
import { loadTasks, saveTasksDoc, retryingShellRunner, shellRunner, type CommandRunner, type VerifyRun } from "./run.js";
import type { Task } from "./tasks.js";
import { agentRunStatus, capReason } from "./agentruns.js";

export const DEPLOY_TARGETS = ["none", "local", "preview"] as const;
export type DeployTarget = (typeof DEPLOY_TARGETS)[number];
export const DEFAULT_MAX_FIX_ROUNDS = 3;
/** Layers a web project is expected to run (Q5: comprehensive by default); missing ones are warnings. */
export const EXPECTED_LAYERS = ["code", "unit", "e2e"] as const;
/** Layers the quality report lists as "not covered" when the profile leaves them out (S7). */
export const RECOMMENDED_LAYERS = ["ui-ux", "a11y", "security", "performance"] as const;
/**
 * Review layers (S7, D-28): after its commands pass, the layer waits for an independent read-only reviewer
 * subagent (`aidw:ui-ux-designer` for ui, `aidw:security` for security, `aidw:performance` for performance) whose verdict the orchestrator records with `aidw layer-review`.
 */
export const REVIEW_KINDS = ["ui", "security", "performance"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

export interface Layer {
  name: string;
  setup: string[];
  run: string[];
  /** JUnit XML files the layer writes (project-relative); converge reads test results from them */
  reports: string[];
  /** independent reviewer that judges this layer after its commands pass (null: commands only) */
  review: ReviewKind | null;
  /** project-relative globs of files the reviewer must open (screenshots, audit reports) */
  artifacts: string[];
}

export interface QualityConfig {
  layers: Layer[];
  deploy: { target: DeployTarget; command: string | null; smoke: string[] };
  permissions: Tier2Resource[];
  maxFixRounds: number;
  /** S8: parallel waves of tasks with disjoint touches, each in its own git worktree */
  parallel: ParallelConfig;
  /** what the user grants at the Approval Gate (push and pull request, envelope, Agent-run cap): src/grants.ts */
  grants: Grants;
}

export interface ParallelConfig {
  /** most tasks in one wave; 1 runs every task sequentially */
  max: number;
  /** commands run inside each new worktree before its implementer starts (e.g. an offline install) */
  setup: string[];
}

export const DEFAULT_PARALLEL: ParallelConfig = { max: 3, setup: [] };

const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim() !== "");
const isProjectRelative = (r: string) => !r.startsWith("/") && !r.split("/").includes("..");
const LAYER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const qualityFile = (change: Change) => join(change.dir, "quality.yaml");

/** Parses and validates quality.yaml. Returns the config only when there are no errors. */
export function parseQuality(text: string, file: string): { config: QualityConfig | null; diags: Diags } {
  const d = new Diags();
  let data: Record<string, unknown>;
  try {
    data = (YAML.parse(text) ?? {}) as Record<string, unknown>;
  } catch (e) {
    d.error(file, `not valid YAML: ${(e as Error).message}`);
    return { config: null, diags: d };
  }

  const layers: Layer[] = [];
  if (!Array.isArray(data.layers) || data.layers.length === 0) d.error(file, 'expected a non-empty "layers:" list');
  else {
    for (const [i, raw] of (data.layers as unknown[]).entries()) {
      const l = (raw ?? {}) as Record<string, unknown>;
      const where = typeof l.name === "string" ? `layer "${l.name}"` : `layer #${i + 1}`;
      if (typeof l.name !== "string" || !LAYER_NAME.test(l.name)) d.error(file, `${where} needs a kebab-case "name"`);
      else if (layers.some((x) => x.name === l.name)) d.error(file, `duplicate layer "${l.name}"`);
      const review = l.review === undefined || l.review === null ? null : String(l.review);
      if (review !== null && !(REVIEW_KINDS as readonly string[]).includes(review)) {
        d.error(file, `${where}: "review" must be one of ${REVIEW_KINDS.join(", ")} (a reviewing Role exists for each)`);
      }
      if (l.run === undefined && review !== null) {
        // a pure review layer: nothing to run, the reviewer judges the code and the artifacts
      } else if (!isStrList(l.run) || l.run.length === 0) d.error(file, `${where} needs a non-empty "run" list of commands${review ? "" : ' (or "review: ui|security|performance")'}`);
      if (l.setup !== undefined && !isStrList(l.setup)) d.error(file, `${where}: "setup" must be a list of commands`);
      if (l.reports !== undefined && !(isStrList(l.reports) && l.reports.every(isProjectRelative))) {
        d.error(file, `${where}: "reports" must be a list of project-relative JUnit XML paths`);
      }
      if (l.artifacts !== undefined && !(isStrList(l.artifacts) && l.artifacts.every(isProjectRelative))) {
        d.error(file, `${where}: "artifacts" must be a list of project-relative file globs`);
      }
      if (l.artifacts !== undefined && review === null) d.warn(file, `${where}: "artifacts" only matter to a review layer; add "review:" or drop them`);
      layers.push({
        name: String(l.name),
        setup: isStrList(l.setup) ? l.setup : [],
        run: isStrList(l.run) ? l.run : [],
        reports: isStrList(l.reports) ? l.reports : [],
        review: review as ReviewKind | null,
        artifacts: isStrList(l.artifacts) ? l.artifacts : [],
      });
    }
    for (const name of EXPECTED_LAYERS) {
      if (!layers.some((l) => l.name === name)) d.warn(file, `no "${name}" layer; say in analysis.md why this project does not need it`);
    }
  }

  const permissions: Tier2Resource[] = [];
  if (data.permissions !== undefined && data.permissions !== null) {
    if (!Array.isArray(data.permissions)) d.error(file, '"permissions" must be a list of tier-2 resource keys');
    else {
      for (const k of data.permissions as unknown[]) {
        if (typeof k === "string" && isTier2Resource(k)) permissions.push(k);
        else d.error(file, `unknown tier-2 resource "${String(k)}" (known: ${Object.keys(TIER2_RESOURCES).join(", ")})`);
      }
    }
  }

  const dep = (data.deploy ?? {}) as Record<string, unknown>;
  const target = (dep.target ?? "none") as DeployTarget;
  if (!(DEPLOY_TARGETS as readonly string[]).includes(String(target))) {
    d.error(file, `deploy.target must be one of ${DEPLOY_TARGETS.join(", ")} (production is tier 3 and never automatic)`);
  }
  const command = typeof dep.command === "string" && dep.command.trim() ? dep.command.trim() : null;
  if (dep.smoke !== undefined && !isStrList(dep.smoke)) d.error(file, '"deploy.smoke" must be a list of commands');
  if (target === "preview") {
    if (!command) d.error(file, 'deploy.target "preview" needs deploy.command');
    else {
      const tier3 = firstMatch(ASK_COMMANDS, command);
      const tier2 = firstMatch(TIER2_COMMANDS, command);
      if (tier3) d.error(file, `deploy.command ${tier3.why}: tier 3 is never automatic`);
      else if (!tier2) d.error(file, "deploy.command must be a recognized preview deploy (vercel deploy, netlify deploy) because it runs without asking");
      else if (!permissions.includes(tier2.resource)) d.error(file, `deploy.command needs "${tier2.resource}" in permissions`);
    }
  }

  const max = data.max_fix_rounds ?? DEFAULT_MAX_FIX_ROUNDS;
  if (!(Number.isInteger(max) && Number(max) >= 1)) d.error(file, '"max_fix_rounds" must be a positive integer');

  const par = (data.parallel ?? {}) as Record<string, unknown>;
  if (data.parallel !== undefined && (typeof data.parallel !== "object" || data.parallel === null || Array.isArray(data.parallel))) {
    d.error(file, '"parallel" must be a mapping with "max" and optional "setup"');
  }
  const parMax = par.max ?? DEFAULT_PARALLEL.max;
  if (!(Number.isInteger(parMax) && Number(parMax) >= 1 && Number(parMax) <= 10)) d.error(file, '"parallel.max" must be an integer from 1 to 10');
  if (par.setup !== undefined && !isStrList(par.setup)) d.error(file, '"parallel.setup" must be a list of commands');
  const grants = parseGrants(data.grants, file, d);

  if (d.errors.length) return { config: null, diags: d };
  return {
    config: {
      layers,
      deploy: { target, command, smoke: isStrList(dep.smoke) ? dep.smoke : [] },
      permissions,
      maxFixRounds: Number(max),
      parallel: { max: Number(parMax), setup: isStrList(par.setup) ? par.setup : [] },
      grants,
    },
    diags: d,
  };
}

export function loadQuality(p: Paths, change: Change): QualityConfig {
  const file = qualityFile(change);
  const text = readText(file);
  if (text === null) throw new OpError(`change "${change.id}" has no quality.yaml`);
  const { config, diags } = parseQuality(text, rel(p, file));
  if (!config) throw new OpError(`quality.yaml of "${change.id}" is invalid`, diags);
  return config;
}

/** Tier-2 resources granted by changes whose gate is open (approved, valid, not paused or escalated). */
export function grantedResources(p: Paths, ids: string[], openStates: ReadonlySet<string>): Set<Tier2Resource> {
  const out = new Set<Tier2Resource>();
  for (const id of ids) {
    try {
      const c = loadChange(p, id);
      const state = stateOf(c);
      if (!state || !openStates.has(state) || approvalStatus(p, c).status !== "valid") continue;
      const text = readText(qualityFile(c));
      if (text === null) continue;
      for (const r of parseQuality(text, "quality.yaml").config?.permissions ?? []) out.add(r);
    } catch {
      // an unreadable change grants nothing
    }
  }
  return out;
}

// ---------------------------------------------------------------- evidence

export interface TestCase {
  name: string;
  status: "pass" | "fail" | "skipped";
  /** failure message (first lines), for failing cases only */
  message?: string;
}

export interface LayerReview {
  verdict: "pass" | "fix";
  notes: string;
  at: string;
}

export interface LayerResult {
  /**
   * `review`: commands passed, the layer waits for the reviewer's verdict (aidw layer-review). `not_built`: its fix
   * rounds ran out (or the Agent-run cap was reached), so the run carries on without it and the pull request is a draft
   * (ADR-0014); it stays so until the quality summary is reset.
   */
  status: "pass" | "fail" | "review" | "not_built";
  /** not_built: why */
  not_built_reason?: string;
  at: string;
  head: string | null;
  runs: VerifyRun[];
  /** test cases read from the layer's JUnit reports after this run */
  tests?: TestCase[];
  /** declared reports that were missing or unreadable after the run */
  missing_reports?: string[];
  /** review layers: the brief written for the reviewer (project-relative) */
  brief?: string;
  /** review layers: artifacts found for the reviewer (project-relative) */
  artifacts?: string[];
  /** review layers: the recorded verdict */
  review?: LayerReview;
}

export interface QualitySummary {
  layers: Record<string, LayerResult>;
}

const qualityDir = (change: Change) => join(change.dir, "evidence", "quality");
const summaryFile = (change: Change) => join(qualityDir(change), "summary.json");
const deployFile = (change: Change) => join(change.dir, "evidence", "deploy.json");
const now = () => new Date().toISOString();

/** Stores a layer result in the summary and appends it to the layer's history. */
export function recordLayerResult(change: Change, summary: QualitySummary, name: string, result: LayerResult): void {
  summary.layers[name] = result;
  writeJson(summaryFile(change), summary);
  appendHistory(join(qualityDir(change), `${name}.json`), result);
}

/** Forgets every layer result (code changed under them); the per-layer history files stay. */
export function resetQualitySummary(change: Change): void {
  writeJson(summaryFile(change), { layers: {} });
}

export function readSummary(change: Change): QualitySummary {
  const f = summaryFile(change);
  if (!existsSync(f)) return { layers: {} };
  try {
    return JSON.parse(readFileSync(f, "utf8")) as QualitySummary;
  } catch {
    return { layers: {} };
  }
}

function writeJson(file: string, data: unknown): void {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

/** Latest moment code was accepted: a layer result older than this says nothing about the current code. */
function codeChangedAt(tasks: Task[]): string {
  return tasks.reduce((m, t) => (typeof t.finished_at === "string" && t.finished_at > m ? t.finished_at : m), "");
}

/** A layer result counts only if it is newer than the last finished task and, with git, ran on HEAD. */
export function isFresh(r: LayerResult | undefined, tasks: Task[], head: string | null): boolean {
  if (!r) return false;
  if (r.at < codeChangedAt(tasks)) return false;
  return head === null || r.head === head;
}

/** Layers that have not passed on the current code, in order. */
export function pendingLayers(p: Paths, id: string): { config: QualityConfig; pending: string[]; summary: QualitySummary } {
  const change = loadChange(p, id);
  const config = loadQuality(p, change);
  const tasks = loadTasks(p, id).tasks;
  const summary = readSummary(change);
  const head = headCommit(p.project);
  const pending = config.layers
    .filter((l) => summary.layers[l.name]?.status !== "not_built")
    .filter((l) => !(summary.layers[l.name]?.status === "pass" && isFresh(summary.layers[l.name], tasks, head)))
    .map((l) => l.name);
  return { config, pending, summary };
}

/** Layers the run gave up on (ADR-0014): what the pull request lists as still failing. */
export function notBuiltLayers(change: Change): { layer: string; reason: string }[] {
  return Object.entries(readSummary(change).layers)
    .filter(([, r]) => r.status === "not_built")
    .map(([layer, r]) => ({ layer, reason: r.not_built_reason ?? "" }));
}

// ---------------------------------------------------------------- JUnit

const TESTCASE = /<testcase\b((?:[^>"']|"[^"]*"|'[^']*')*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
const MAX_TESTS = 10000;

function xmlAttr(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`)) ?? attrs.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`));
  return decodeXml(m?.[1] ?? "");
}

function decodeXml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

/** Test cases from JUnit XML (vitest, Playwright, node --test, jest-junit all write this format). */
export function parseJunit(xml: string): TestCase[] {
  const out: TestCase[] = [];
  for (const m of xml.matchAll(TESTCASE)) {
    const attrs = m[1] ?? "";
    const body = m[2] ?? "";
    const name = [xmlAttr(attrs, "classname"), xmlAttr(attrs, "name")].filter(Boolean).join(" > ");
    const status = /<(failure|error)\b/.test(body) ? "fail" : /<skipped\b/.test(body) ? "skipped" : "pass";
    const tc: TestCase = { name, status };
    if (status === "fail") {
      const f = /<(?:failure|error)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(?:\/>|>([\s\S]*?)<\/(?:failure|error)>)/.exec(body);
      const text = `${xmlAttr(f?.[1] ?? "", "message")}\n${decodeXml((f?.[2] ?? "").replace(/<!\[CDATA\[|\]\]>/g, ""))}`.trim();
      if (text) tc.message = text.replace(/\x1b\[[0-9;]*m/g, "").split("\n").slice(0, 12).join("\n").slice(0, 1200);
    }
    out.push(tc);
    if (out.length >= MAX_TESTS) break;
  }
  return out;
}

export function readJunit(project: string, reports: string[]): { tests: TestCase[]; missing: string[] } {
  const tests: TestCase[] = [];
  const missing: string[] = [];
  for (const r of reports) {
    const f = join(project, ...r.split("/"));
    if (!existsSync(f)) {
      missing.push(r);
      continue;
    }
    tests.push(...parseJunit(readFileSync(f, "utf8")));
  }
  return { tests, missing };
}

// ---------------------------------------------------------------- verify

export interface VerifyLayerOutcome {
  name: string;
  /** `review`: the layer waits for its reviewer (see VerifyResult.awaitingReview) */
  status: "pass" | "fail" | "skipped" | "review" | "not_built";
  runs: VerifyRun[];
  /** skipped because it already passed on this commit (rerun with --fresh) */
  reused?: boolean;
}

export interface AwaitingReview {
  layer: string;
  kind: ReviewKind;
  /** subagent to spawn, e.g. aidw:ui-ux-designer */
  agent: string;
  /** project-relative path of the review brief */
  brief: string;
  artifacts: string[];
  /** the reviewer drives the project's test browser (ui): one at a time */
  browser: boolean;
}

export interface VerifyResult {
  ok: boolean;
  layers: VerifyLayerOutcome[];
  failed?: string;
  /** fix task added for the failing layer (the change is back in executing) */
  fixTask?: string;
  /** layers given up on in this run: fix rounds exhausted or the Agent-run cap reached (ADR-0014; the rest carries on) */
  notBuilt?: string[];
  /** a review layer's commands passed; verify stops until `aidw layer-review` records the verdict (the first of awaitingReviews) */
  awaitingReview?: AwaitingReview;
  /** D13: the review layers whose reviewers run now, at the same time (src/stages.ts pickGroup) */
  awaitingReviews?: AwaitingReview[];
  /** review layers also awaiting a reviewer, offered after this group (one browser user, parallel.max) */
  waitingReviews?: string[];
  summary: string;
}

function runCommands(commands: string[], cwd: string, timeoutMs: number, runner: CommandRunner, env?: Record<string, string>): VerifyRun[] {
  const runs: VerifyRun[] = [];
  for (const command of commands) {
    const started = Date.now();
    const r = runner(command, cwd, timeoutMs, env);
    runs.push({ command, ms: Date.now() - started, ...r });
    if (r.exit !== 0) break;
  }
  return runs;
}

const failedRun = (runs: VerifyRun[]) => runs.find((r) => r.exit !== 0);

/** Verify and layer-review run only while the change is verifying with a valid approval. */
export function requireVerifying(p: Paths, id: string, what: string): Change {
  const change = loadChange(p, id);
  if (stateOf(change) !== "verifying") throw new OpError(`change "${id}" is "${String(change.data.state)}"; ${what} runs in state verifying`);
  if (approvalStatus(p, change).status !== "valid") throw new OpError(`approval drift in "${id}": escalate and re-approve`);
  return change;
}

/**
 * Verdicts of a parallel review group (D13): when one reviewer's fix verdict already sent the change back to
 * executing, the others of the group may still be recorded while their layer awaits review on unchanged code.
 */
function requireReviewable(p: Paths, id: string, name: string): Change {
  const change = loadChange(p, id);
  if (stateOf(change) === "executing" && approvalStatus(p, change).status === "valid") {
    const prev = readSummary(change).layers[name];
    if (prev?.status === "review" && isFresh(prev, loadTasks(p, id).tasks, headCommit(p.project))) return change;
  }
  return requireVerifying(p, id, "aidw layer-review");
}

const reviewAgent = (kind: ReviewKind) => AGENTS.layerReview[kind];

function awaiting(layer: Layer, r: LayerResult): AwaitingReview {
  return { layer: layer.name, kind: layer.review as ReviewKind, agent: reviewAgent(layer.review as ReviewKind), brief: r.brief ?? "", artifacts: r.artifacts ?? [], browser: layer.review === "ui" };
}

const awaitingSummary = (group: AwaitingReview[], waiting: string[]) => {
  const later = waiting.length ? `; ${waiting.join(", ")} ${waiting.length === 1 ? "waits" : "wait"} for the next round` : "";
  if (group.length > 1) return `${group.length} review layers await their reviewers, run them in parallel: ${group.map((a) => `"${a.layer}" (${a.kind})`).join(", ")}${later}`;
  const a = group[0] as AwaitingReview;
  return `layer "${a.layer}" awaits its ${a.kind} review: spawn ${a.agent} with the brief ${a.brief}, then \`aidw layer-review ${a.layer} pass|fix --notes-file <reply>\`${later}`;
};

/** D13: the reviewers to run at the same time (one browser user, parallel.max) and the ones offered after them. */
function reviewGroup(reviews: AwaitingReview[], max: number): { group: AwaitingReview[]; waiting: string[] } {
  const picked = pickGroup(reviews.map((a) => ({ id: a.layer, kind: "review" as const, reads: [], writes: [`file:run/layer-review-${a.layer}.md`], browser: a.browser, a })), max).map((x) => x.a);
  return { group: picked, waiting: reviews.filter((a) => !picked.includes(a)).map((a) => a.layer) };
}

export function verify(
  p: Paths,
  id: string,
  opts: { layer?: string; fresh?: boolean; timeoutMs?: number; runner?: CommandRunner; vendorDir?: string } = {},
): VerifyResult {
  const change = requireVerifying(p, id, "aidw verify");
  const { config, pending, summary } = pendingLayers(p, id);
  if (opts.layer && !config.layers.some((l) => l.name === opts.layer)) throw new OpError(`no layer "${opts.layer}" in quality.yaml`);

  const runner = opts.runner ?? retryingShellRunner;
  const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;
  const head = headCommit(p.project);
  const tasks = loadTasks(p, id).tasks;
  const outcomes: VerifyLayerOutcome[] = [];
  let failed: Layer | undefined;
  // D13: a review layer no longer stops the run; every review layer whose commands pass waits, and the reviewers run in parallel.
  const reviews: AwaitingReview[] = [];
  for (const layer of config.layers) {
    const wanted = opts.layer ? layer.name === opts.layer : opts.fresh || pending.includes(layer.name);
    if (!wanted && !failed && summary.layers[layer.name]?.status === "not_built") {
      outcomes.push({ name: layer.name, status: "not_built", runs: [] });
      continue;
    }
    if (!wanted || failed) {
      const reused = !failed && !opts.layer && !pending.includes(layer.name);
      outcomes.push({ name: layer.name, status: "skipped", runs: [], ...(reused ? { reused: true } : {}) });
      continue;
    }
    // A review layer whose commands already passed on this code keeps waiting for its verdict; no rerun.
    const prev = summary.layers[layer.name];
    if (layer.review && prev?.status === "review" && isFresh(prev, tasks, head) && !opts.fresh) {
      reviews.push(awaiting(layer, prev));
      outcomes.push({ name: layer.name, status: "review", runs: prev.runs });
      continue;
    }
    const runs = runCommands([...layer.setup, ...layer.run], p.project, timeoutMs, runner);
    let ok = runs.length === layer.setup.length + layer.run.length && !failedRun(runs);
    const result: LayerResult = { status: ok ? "pass" : "fail", at: now(), head, runs };
    if (layer.reports.length) {
      const { tests, missing } = readJunit(p.project, layer.reports);
      result.tests = tests;
      if (missing.length) result.missing_reports = missing;
      if (missing.length && ok) {
        // A layer whose declared JUnit report is absent proves nothing per scenario (trial-3A: the e2e config had
        // `reporter: "list"`). Failing it makes the fix loop add the reporter instead of shipping blind.
        const list = missing.join(", ");
        ok = false;
        result.status = "fail";
        result.runs = [...runs, { command: `(declared report ${list})`, ms: 0, exit: 1, timedOut: false, tail: `the command passed but wrote no JUnit report ${list}: configure the test runner's JUnit reporter (Playwright: reporter [["list"], ["junit", { outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT_NAME ?? "<file>" }]]; Vitest: --reporter=junit --outputFile.junit=<file>)` }];
      }
    }
    if (ok && layer.review) {
      const brief = buildLayerBrief(p, id, layer, runs, opts.vendorDir);
      result.status = "review";
      result.brief = rel(p, brief.path);
      result.artifacts = brief.artifacts;
      reviews.push(awaiting(layer, result));
    }
    recordLayerResult(change, summary, layer.name, result);
    outcomes.push({ name: layer.name, status: result.status, runs: result.runs });
    if (!ok) failed = layer;
  }

  if (reviews.length && !failed) {
    const { group, waiting } = reviewGroup(reviews, config.parallel.max);
    return { ok: false, layers: outcomes, awaitingReview: group[0] as AwaitingReview, awaitingReviews: group, waitingReviews: waiting, summary: awaitingSummary(group, waiting) };
  }
  if (!failed) {
    const left = pendingLayers(p, id).pending;
    const ok = left.length === 0;
    const off = notBuiltLayers(change).map((x) => x.layer);
    const passed = off.length ? `every other quality layer passes (not built: ${off.join(", ")})` : "all quality layers pass";
    return { ok, layers: outcomes, summary: ok ? passed : `layers still to run: ${left.join(", ")}` };
  }

  const bad = failedRun(summary.layers[failed.name]?.runs ?? []);
  const failing = (summary.layers[failed.name]?.tests ?? []).filter((t) => t.status === "fail");
  const cases = failing.length
    ? `Failing tests (from the JUnit report):\n${failing
        .slice(0, 10)
        .map((t) => `- ${t.name}${t.message ? `\n${t.message.replace(/^/gm, "    ")}` : ""}`)
        .join("\n")}${failing.length > 10 ? `\n- ... and ${failing.length - 10} more` : ""}\n\nOutput tail:\n`
    : "";
  const problem = bad
    ? `Quality layer "${failed.name}" failed: \`${bad.command}\`${bad.timedOut ? " timed out" : ` exited ${bad.exit}`}.\n\n${cases}${bad.tail}`
    : `Quality layer "${failed.name}" did not complete.`;
  const fix = addFixTask(p, id, config, failed, problem);
  if (fix.notBuilt && !opts.layer) {
    // The run carries on without it (ADR-0014): the layers after it run now.
    const rest = verify(p, id, opts);
    return { ...rest, notBuilt: [failed.name, ...(rest.notBuilt ?? [])], summary: `${fix.summary}; ${rest.summary}` };
  }
  const { notBuilt, ...outcome } = fix;
  return { ok: false, layers: outcomes, failed: failed.name, ...outcome, ...(notBuilt ? { notBuilt: [failed.name] } : {}) };
}

export interface FixOutcome {
  fixTask?: string;
  /** the layer is not built: its fix rounds are exhausted, or the Agent-run cap was reached */
  notBuilt?: boolean;
  summary: string;
}

/**
 * A failing layer becomes a fix task in the normal loop, within the approved fix-round budget. Past the budget, or at
 * the cap on Agent runs, the layer is not built: nobody is asked (ADR-0014), the run goes on and the pull request is a
 * draft that lists it.
 */
export function addFixTask(p: Paths, id: string, config: QualityConfig, layer: Layer, problem: string): FixOutcome {
  const tf = loadTasks(p, id);
  const rounds = tf.tasks.filter((t) => t.origin === "quality" && t.layer === layer.name).length;
  const cap = agentRunStatus(p, tf.change);
  if (rounds >= config.maxFixRounds || cap.reached) {
    const reason = cap.reached && rounds < config.maxFixRounds ? `${capReason(cap)}; no fix task starts` : `still failing after ${rounds} fix round(s) (max_fix_rounds ${config.maxFixRounds})`;
    const summary = readSummary(tf.change);
    const prev = summary.layers[layer.name];
    recordLayerResult(tf.change, summary, layer.name, { ...(prev ?? { runs: [] }), status: "not_built", at: now(), head: headCommit(p.project), not_built_reason: `${reason}: ${problem.split("\n")[0] ?? ""}`.slice(0, 500) });
    return { notBuilt: true, summary: `layer "${layer.name}" failed and is not built: ${reason}; the run carries on and the pull request lists it` };
  }
  const n = tf.tasks.filter((t) => t.origin === "quality").length + 1;
  const taskId = `Q${String(n).padStart(2, "0")}`;
  const task = {
    id: taskId,
    title: `Fix the ${layer.name} quality layer`,
    role: defaultTaskRole(),
    origin: "quality",
    layer: layer.name,
    depends_on: [],
    touches: ["**"],
    verify: [...layer.setup, ...layer.run],
    problem,
    status: "pending",
  };
  (tf.doc.get("tasks") as YAML.YAMLSeq).add(tf.doc.createNode(task));
  saveTasksDoc(tf);
  // another reviewer of the same parallel group may already have sent the change back to executing
  if (stateOf(loadChange(p, id)) !== "executing") transition(p, id, "executing", {});
  return { fixTask: taskId, summary: `layer "${layer.name}" failed: fix task ${taskId} added (round ${rounds + 1}/${config.maxFixRounds}); change is executing again` };
}

export interface LayerReviewResult {
  layer: string;
  kind: ReviewKind;
  verdict: "pass" | "fix";
  /** layers still to pass after this verdict (pass) */
  pending?: string[];
  fixTask?: string;
  /** the layer is not built (fix rounds exhausted or the Agent-run cap); the group's other verdicts are still recorded */
  notBuilt?: boolean;
  summary: string;
}

/** Records the independent reviewer's verdict on a review layer (the orchestrator's step after the subagent). */
export function recordLayerReview(p: Paths, id: string, name: string, verdict: "pass" | "fix", notes: string): LayerReviewResult {
  const change = requireReviewable(p, id, name);
  const config = loadQuality(p, change);
  const layer = config.layers.find((l) => l.name === name);
  if (!layer) throw new OpError(`no layer "${name}" in quality.yaml`);
  if (!layer.review) throw new OpError(`layer "${name}" has no "review:" kind; only review layers take a verdict`);
  const summary = readSummary(change);
  const prev = summary.layers[name];
  const head = headCommit(p.project);
  if (prev?.status !== "review" || !isFresh(prev, loadTasks(p, id).tasks, head)) {
    throw new OpError(`layer "${name}" is not awaiting review on the current code; run \`aidw verify\` first`);
  }
  if (verdict === "fix" && !notes.trim()) throw new OpError("a fix verdict needs the reviewer's notes");
  const review: LayerReview = { verdict, notes: notes.trim(), at: now() };
  recordLayerResult(change, summary, name, { ...prev, status: verdict === "pass" ? "pass" : "fail", at: review.at, review });
  if (verdict === "pass") {
    const left = pendingLayers(p, id).pending;
    return { layer: name, kind: layer.review, verdict, pending: left, summary: left.length ? `layer "${name}" passed its ${layer.review} review; layers still to run: ${left.join(", ")}` : `layer "${name}" passed its ${layer.review} review; all quality layers pass` };
  }
  const problem = `Quality layer "${name}" (${layer.review} review) asked for fixes. The reviewer's notes, verbatim:\n\n${review.notes}`;
  return { layer: name, kind: layer.review, verdict, ...addFixTask(p, id, config, layer, problem) };
}

function appendHistory(file: string, entry: unknown): void {
  let history: unknown[] = [];
  if (existsSync(file)) {
    try {
      const data = JSON.parse(readFileSync(file, "utf8")) as { runs?: unknown[] };
      history = Array.isArray(data.runs) ? data.runs : [];
    } catch {
      history = [];
    }
  }
  writeJson(file, { runs: [...history, entry] });
}

/** True when every layer passed on the current code (the guard for leaving verifying). */
export function qualityPassed(p: Paths, id: string): { ok: boolean; pending: string[] } {
  const { pending } = pendingLayers(p, id);
  return { ok: pending.length === 0, pending };
}

// ---------------------------------------------------------------- deploy

export interface DeployRecord {
  at: string;
  target: DeployTarget;
  ok: boolean;
  skipped: boolean;
  url: string | null;
  head: string | null;
  runs: VerifyRun[];
  smoke: VerifyRun[];
  error?: string;
}

const URL_RE = /https:\/\/[^\s"'<>`)\]]+/g;
/** Vercel `--format json` / JSON output: the deployment's own URL. */
const JSON_URL = /"url"\s*:\s*"(https:\/\/[^"\s]+)"/;
const DASHBOARD_URL = /^https:\/\/(?:(?:www\.)?vercel\.com|app\.netlify\.com|supabase\.com)\//;

export function deploy(p: Paths, id: string, opts: { timeoutMs?: number; runner?: CommandRunner } = {}): DeployRecord {
  const change = loadChange(p, id);
  if (stateOf(change) !== "deploying") throw new OpError(`change "${id}" is "${String(change.data.state)}"; aidw deploy runs in state deploying`);
  if (approvalStatus(p, change).status !== "valid") throw new OpError(`approval drift in "${id}": escalate and re-approve`);
  const config = loadQuality(p, change);
  const runner = opts.runner ?? shellRunner;
  const timeoutMs = opts.timeoutMs ?? 20 * 60 * 1000;
  const head = headCommit(p.project);
  const base = { at: now(), target: config.deploy.target, head, runs: [] as VerifyRun[], smoke: [] as VerifyRun[] };

  let record: DeployRecord;
  if (config.deploy.target !== "preview" || !config.deploy.command) {
    record = { ...base, ok: true, skipped: true, url: null };
  } else {
    const runs = runCommands([config.deploy.command], p.project, timeoutMs, runner);
    const failed = failedRun(runs);
    const url = deploymentUrl(runs[0]?.tail ?? "");
    // The deploy CLI may touch project files (`vercel` links the project and adds `.vercel` to .gitignore).
    // That is the approved deploy step, not the agent, so the backstop must not blame the agent for it.
    recordBaseline(p);
    if (failed || !url) {
      record = { ...base, runs, ok: false, skipped: false, url, error: failed
          ? `deploy command exited ${failed.exit}${deployHint(failed.tail) ? `: ${deployHint(failed.tail)}` : ""}`
          : "no https URL in the deploy output" };
    } else {
      const smoke = runCommands(config.deploy.smoke, p.project, timeoutMs, runner, { AIDW_DEPLOY_URL: url });
      const smokeFailed = failedRun(smoke);
      record = { ...base, runs, smoke, url, ok: !smokeFailed, skipped: false, ...(smokeFailed ? { error: `smoke check failed: ${smokeFailed.command}` } : {}) };
    }
  }
  appendHistory(deployFile(change), record);
  return record;
}

/**
 * The deployment URL in a deploy CLI's output. Prefers the JSON `"url"` of the deployment, then the last URL that
 * is neither a dashboard link ("Inspect: https://vercel.com/...") nor an alias line ("Aliased https://app.vercel.app",
 * which may point at production or sit behind protection).
 */
/** Known deploy CLI failures inside Claude Code's sandbox, with what the user does about them. */
const DEPLOY_HINTS: { re: RegExp; hint: string }[] = [
  {
    re: /"err" is out of range|persistAuthConfig|EPERM[^\n]*com\.vercel\.cli/,
    hint: "the Vercel CLI had to refresh its login token and the sandbox blocked writing its auth file. The user runs `vercel whoami` in their own terminal (outside Claude Code), then `aidw deploy` again.",
  },
  {
    re: /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|getaddrinfo/i,
    hint: "the sandbox blocked the network. The user allows the deploy host (for Vercel: vercel.com and *.vercel.com) in the sandbox network settings, or runs the command in their own terminal, then `aidw deploy` again.",
  },
  {
    re: /STATIC_BUILD_NO_OUT_DIR|No Output Directory named/i,
    hint: 'Vercel does not know the framework: the project was linked before the app existed and was saved with preset "Other". Commit a vercel.json with {"framework": "nextjs"} (or the framework in use) and deploy again.',
  },
  {
    re: /first_deployment_production|has no deployments yet|first deployment is assigned to Production/i,
    hint: "a Vercel project's first deployment is always Production, and `--environment=preview` (or `vercel link`) does not change that. This is the user's decision (tier 3): either they run `aidw first-deploy --yes` in their own terminal (one public Production deployment, so only for non-sensitive data) and `aidw deploy` works after that, or the deploy target is set to none. Never use --prod yourself.",
  },
  {
    re: /No existing credentials found|not logged in|vercel login/i,
    hint: "the Vercel CLI is not logged in. The user runs `vercel login` in their own terminal, then `aidw deploy` again.",
  },
];

export function deployHint(output: string): string | null {
  return DEPLOY_HINTS.find((h) => h.re.test(output))?.hint ?? null;
}

export function deploymentUrl(output: string): string | null {
  const json = JSON_URL.exec(output);
  if (json) return json[1] as string;
  const urls: string[] = [];
  for (const line of output.split("\n")) {
    if (/\balias(?:ed)?\b/i.test(line)) continue;
    for (const m of line.matchAll(URL_RE)) if (!DASHBOARD_URL.test(m[0])) urls.push(m[0]);
  }
  return urls.at(-1) ?? null;
}

export function lastDeploy(change: Change): DeployRecord | null {
  const f = deployFile(change);
  if (!existsSync(f)) return null;
  try {
    const runs = (JSON.parse(readFileSync(f, "utf8")) as { runs?: DeployRecord[] }).runs ?? [];
    return runs.at(-1) ?? null;
  } catch {
    return null;
  }
}

