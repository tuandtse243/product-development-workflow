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
import { join } from "node:path";
import YAML from "yaml";
import { approvalStatus } from "./approval.js";
import { loadChange, stateOf, type Change } from "./change.js";
import { Diags } from "./diag.js";
import { headCommit } from "./git.js";
import { OpError, transition } from "./ops.js";
import { firstMatch, isTier2Resource, TIER2_COMMANDS, TIER2_RESOURCES, ASK_COMMANDS, type Tier2Resource } from "./policy.js";
import { readText, rel, type Paths } from "./project.js";
import { loadTasks, saveTasksDoc, shellRunner, type CommandRunner, type VerifyRun } from "./run.js";
import type { Task } from "./tasks.js";

export const DEPLOY_TARGETS = ["none", "local", "preview"] as const;
export type DeployTarget = (typeof DEPLOY_TARGETS)[number];
export const DEFAULT_MAX_FIX_ROUNDS = 3;
/** Layers a web project is expected to run (Q5: comprehensive by default); missing ones are warnings. */
export const EXPECTED_LAYERS = ["code", "unit", "e2e"] as const;

export interface Layer {
  name: string;
  setup: string[];
  run: string[];
  /** JUnit XML files the layer writes (project-relative); converge reads test results from them */
  reports: string[];
}

export interface QualityConfig {
  layers: Layer[];
  deploy: { target: DeployTarget; command: string | null; smoke: string[] };
  permissions: Tier2Resource[];
  maxFixRounds: number;
}

const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim() !== "");
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
      if (!isStrList(l.run) || l.run.length === 0) d.error(file, `${where} needs a non-empty "run" list of commands`);
      if (l.setup !== undefined && !isStrList(l.setup)) d.error(file, `${where}: "setup" must be a list of commands`);
      if (l.reports !== undefined && !(isStrList(l.reports) && l.reports.every((r) => !r.startsWith("/") && !r.split("/").includes("..")))) {
        d.error(file, `${where}: "reports" must be a list of project-relative JUnit XML paths`);
      }
      layers.push({
        name: String(l.name),
        setup: isStrList(l.setup) ? l.setup : [],
        run: isStrList(l.run) ? l.run : [],
        reports: isStrList(l.reports) ? l.reports : [],
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

  if (d.errors.length) return { config: null, diags: d };
  return {
    config: {
      layers,
      deploy: { target, command, smoke: isStrList(dep.smoke) ? dep.smoke : [] },
      permissions,
      maxFixRounds: Number(max),
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
}

export interface LayerResult {
  status: "pass" | "fail";
  at: string;
  head: string | null;
  runs: VerifyRun[];
  /** test cases read from the layer's JUnit reports after this run */
  tests?: TestCase[];
  /** declared reports that were missing or unreadable after the run */
  missing_reports?: string[];
}

export interface QualitySummary {
  layers: Record<string, LayerResult>;
}

const qualityDir = (change: Change) => join(change.dir, "evidence", "quality");
const summaryFile = (change: Change) => join(qualityDir(change), "summary.json");
const deployFile = (change: Change) => join(change.dir, "evidence", "deploy.json");
const now = () => new Date().toISOString();

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
  const pending = config.layers.filter((l) => !(summary.layers[l.name]?.status === "pass" && isFresh(summary.layers[l.name], tasks, head))).map((l) => l.name);
  return { config, pending, summary };
}

// ---------------------------------------------------------------- JUnit

const TESTCASE = /<testcase\b((?:[^>"']|"[^"]*"|'[^']*')*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
const MAX_TESTS = 10000;

function xmlAttr(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`)) ?? attrs.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`));
  return (m?.[1] ?? "")
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
    out.push({ name, status });
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
  status: "pass" | "fail" | "skipped";
  runs: VerifyRun[];
}

export interface VerifyResult {
  ok: boolean;
  layers: VerifyLayerOutcome[];
  failed?: string;
  /** fix task added for the failing layer (the change is back in executing) */
  fixTask?: string;
  /** fix rounds for the failing layer are exhausted (the change is escalated) */
  escalated?: boolean;
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

export function verify(
  p: Paths,
  id: string,
  opts: { layer?: string; fresh?: boolean; timeoutMs?: number; runner?: CommandRunner } = {},
): VerifyResult {
  const change = loadChange(p, id);
  if (stateOf(change) !== "verifying") throw new OpError(`change "${id}" is "${String(change.data.state)}"; aidw verify runs in state verifying`);
  if (approvalStatus(p, change).status !== "valid") throw new OpError(`approval drift in "${id}": escalate and re-approve`);
  const { config, pending, summary } = pendingLayers(p, id);
  if (opts.layer && !config.layers.some((l) => l.name === opts.layer)) throw new OpError(`no layer "${opts.layer}" in quality.yaml`);

  const runner = opts.runner ?? shellRunner;
  const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;
  const head = headCommit(p.project);
  const outcomes: VerifyLayerOutcome[] = [];
  let failed: Layer | undefined;
  for (const layer of config.layers) {
    const wanted = opts.layer ? layer.name === opts.layer : opts.fresh || pending.includes(layer.name);
    if (!wanted || failed) {
      outcomes.push({ name: layer.name, status: "skipped", runs: [] });
      continue;
    }
    const runs = runCommands([...layer.setup, ...layer.run], p.project, timeoutMs, runner);
    const ok = runs.length === layer.setup.length + layer.run.length && !failedRun(runs);
    const result: LayerResult = { status: ok ? "pass" : "fail", at: now(), head, runs };
    if (layer.reports.length) {
      const { tests, missing } = readJunit(p.project, layer.reports);
      result.tests = tests;
      if (missing.length) result.missing_reports = missing;
    }
    summary.layers[layer.name] = result;
    writeJson(summaryFile(change), summary);
    appendHistory(join(qualityDir(change), `${layer.name}.json`), result);
    outcomes.push({ name: layer.name, status: result.status, runs });
    if (!ok) failed = layer;
  }

  if (!failed) {
    const left = pendingLayers(p, id).pending;
    const ok = left.length === 0;
    return { ok, layers: outcomes, summary: ok ? "all quality layers pass" : `layers still to run: ${left.join(", ")}` };
  }

  // A failing layer becomes a fix task in the normal loop, within the approved fix-round budget.
  const tf = loadTasks(p, id);
  const rounds = tf.tasks.filter((t) => t.origin === "quality" && t.layer === failed.name).length;
  const bad = failedRun(summary.layers[failed.name]?.runs ?? []);
  const problem = bad
    ? `Quality layer "${failed.name}" failed: \`${bad.command}\`${bad.timedOut ? " timed out" : ` exited ${bad.exit}`}.\n\n${bad.tail}`
    : `Quality layer "${failed.name}" did not complete.`;
  if (rounds >= config.maxFixRounds) {
    transition(p, id, "escalated", { reason: `quality layer "${failed.name}" still failing after ${rounds} fix round(s)` });
    return { ok: false, layers: outcomes, failed: failed.name, escalated: true, summary: `layer "${failed.name}" failed; fix rounds exhausted (${rounds}/${config.maxFixRounds}): escalated` };
  }
  const n = tf.tasks.filter((t) => t.origin === "quality").length + 1;
  const taskId = `Q${String(n).padStart(2, "0")}`;
  const task = {
    id: taskId,
    title: `Fix the ${failed.name} quality layer`,
    role: "fullstack-engineer",
    origin: "quality",
    layer: failed.name,
    depends_on: [],
    touches: ["**"],
    verify: [...failed.setup, ...failed.run],
    problem,
    status: "pending",
  };
  (tf.doc.get("tasks") as YAML.YAMLSeq).add(tf.doc.createNode(task));
  saveTasksDoc(tf);
  transition(p, id, "executing", {});
  return {
    ok: false,
    layers: outcomes,
    failed: failed.name,
    fixTask: taskId,
    summary: `layer "${failed.name}" failed: fix task ${taskId} added (round ${rounds + 1}/${config.maxFixRounds}); change is executing again`,
  };
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
    // Deploy CLIs also print dashboard links ("Inspect: https://vercel.com/..."); the deployment is the last other URL.
    const url =
      [...(runs[0]?.tail ?? "").matchAll(URL_RE)]
        .map((m) => m[0])
        .filter((u) => !DASHBOARD_URL.test(u))
        .at(-1) ?? null;
    if (failed || !url) {
      record = { ...base, runs, ok: false, skipped: false, url, error: failed ? `deploy command exited ${failed.exit}` : "no https URL in the deploy output" };
    } else {
      const smoke = runCommands(config.deploy.smoke, p.project, timeoutMs, runner, { AIDW_DEPLOY_URL: url });
      const smokeFailed = failedRun(smoke);
      record = { ...base, runs, smoke, url, ok: !smokeFailed, skipped: false, ...(smokeFailed ? { error: `smoke check failed: ${smokeFailed.command}` } : {}) };
    }
  }
  appendHistory(deployFile(change), record);
  return record;
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

