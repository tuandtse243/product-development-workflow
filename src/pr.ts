/**
 * `aidw pr`: the run always ends in a pull request (D12): ready when everything passed, a draft otherwise. The body
 * opens with three fixed sections (src/draft.ts), then the Analysis summary, tasks, evidence and merge danger, all
 * built from primary sources, never from an LLM summary. Pushing and opening the PR is tier 3 (the gate asks for
 * `aidw pr --create`) unless the Approval Gate granted it (src/grants.ts); the pull request opens before the archive,
 * while the grant still covers the Change. `run.pr` in change.yaml records it, so /aidw:resume updates the same one.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { ChangeError, loadChange, saveChange, stateOf, type Change } from "./change.js";
import { aidwCommitMessage, header, scopeOf } from "./commit.js";
import { keepDiscardedWork, prReadiness, prSections } from "./draft.js";
import { boundPush, githubSlug, GRANT_STATES, pushGrantReason, readGrants } from "./grants.js";
import { lastDeploy, readSummary } from "./quality.js";
import { git } from "./git.js";
import { commitAidw, OpError } from "./ops.js";
import { readText, rel, type Paths } from "./project.js";
import { sections } from "./spec/parse.js";
import { parseTasks, type Task } from "./tasks.js";

export interface PrPlan {
  title: string;
  body: string;
  head: string;
  base: string;
  /** the remote the branch is pushed to: the one granted at the Approval Gate, else origin */
  remote: string;
  /** owner/repo of the remote when it is on GitHub: `gh pr create --repo`, so the PR goes where the push went */
  repo: string | null;
  bodyFile: string;
  commands: string[];
  /** D12: ready when everything passed and nothing is not built; a draft otherwise, for the reasons in `why` */
  ready: boolean;
  why: string[];
  /** the gate lets `aidw pr <id> --create` through without asking (the push grant holds now) */
  granted: boolean;
  /** what change.yaml records of the pull request (`run.pr`) */
  record: PrRecord | null;
}

const MIGRATION = /(^|\/)(migrations?|prisma\/migrations|supabase\/migrations|db\/migrate)\//i;
const DEP_FILES = /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|requirements\.txt|pyproject\.toml|go\.mod|Cargo\.toml)$/;

/** What could hurt when this merges: computed from the diff and the plan, plus what the handoff says. */
export function mergeDanger(p: Paths, id: string, tasks: Task[], base: string, head: string): string[] {
  const out: string[] = [];
  for (const t of tasks.filter((x) => x.breaking === true)) out.push(`Breaking change: ${t.id} ${String(t.title ?? "")}`);
  const files = git(p.project, ["diff", "--name-only", `${base}...${head}`, "--", ".", ":(exclude).aidw"]);
  const changed = files.ok && files.out ? files.out.split("\n") : [];
  const mig = changed.filter((f) => MIGRATION.test(f));
  if (mig.length) out.push(`Database migrations (${mig.length}): ${mig.slice(0, 5).join(", ")}. Run them against a seeded copy first; they must be reversible.`);
  const deps = changed.filter((f) => DEP_FILES.test(f));
  if (deps.length) out.push(`Dependencies changed: ${deps.join(", ")}. Reinstall before running.`);
  const env = git(p.project, ["diff", `${base}...${head}`, "--", ".env.example"]);
  const newVars = env.ok ? [...env.out.matchAll(/^\+([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]) : [];
  if (newVars.length) out.push(`New environment variables to set before deploy: ${newVars.join(", ")}.`);
  const handoff = readText(join(loadAny(p, id).dir, "delivery", "handoff.md"));
  const section = handoff ? sections(handoff).find((s) => /^merge danger$/i.test(s.name)) : undefined;
  if (section?.body && !/^\s*none\b/i.test(section.body)) out.push(...section.body.split("\n").filter((l) => /^\s*[-*]\s/.test(l)).map((l) => l.replace(/^\s*[-*]\s+/, "")));
  return out;
}

/** The change, active or already archived (the PR is usually opened after `aidw archive`). */
function loadAny(p: Paths, id: string): Change {
  try {
    return loadChange(p, id);
  } catch (e) {
    const dir = join(p.archive, id);
    const file = join(dir, "change.yaml");
    if (!(e instanceof ChangeError) || !existsSync(file)) throw e;
    const doc = YAML.parseDocument(readFileSync(file, "utf8"));
    return { id, dir, file, doc, data: (doc.toJS() ?? {}) as Record<string, unknown> };
  }
}

export interface PrRecord {
  /** the pull request, once opened; null while only its body is written */
  url: string | null;
  draft: boolean;
  at: string;
}

/** The pull request recorded in change.yaml (`run.pr`), or null. */
export function prRecord(change: Change): PrRecord | null {
  const r = (change.data.run as { pr?: Partial<PrRecord> } | undefined)?.pr;
  if (!r || typeof r !== "object") return null;
  return { url: typeof r.url === "string" && r.url ? r.url : null, draft: r.draft === true, at: String(r.at ?? "") };
}

function savePrRecord(change: Change, r: PrRecord): void {
  change.doc.setIn(["run", "pr"], change.doc.createNode(r));
  saveChange(change);
}

export function planPr(p: Paths, id: string, opts: { base?: string; env?: NodeJS.ProcessEnv } = {}): PrPlan {
  const change = loadAny(p, id);
  const run = (change.data.run ?? {}) as { branch?: string; base_branch?: string };
  // With a push grant, the branch, remote and base fixed at approval (ADR-0012), never a change.yaml edited since.
  const bound = boundPush(p, change);
  const grant = readGrants(change).push;
  const head = bound?.branch ?? run.branch ?? `aidw/${id}`;
  const base = opts.base ?? bound?.base ?? grant?.base ?? run.base_branch ?? "main";
  const remote = bound?.remote ?? grant?.remote ?? "origin";
  const url = git(p.project, ["remote", "get-url", remote]);
  const repo = url.ok ? githubSlug(url.out) : null;
  const tasks = parseTasks(readText(join(change.dir, "tasks.yaml")) ?? "").tasks;
  const planned = tasks.filter((t) => !t.origin);
  const allFix = planned.length > 0 && planned.every((t) => t.type === "fix");
  const first = planned[0];
  const title = header(allFix ? "fix" : "feat", first ? scopeOf(first) : "config", String(change.data.title ?? id));
  const readiness = prReadiness(p, change, tasks);

  const analysis = readText(join(change.dir, "analysis.md"));
  const summary = analysis ? (sections(analysis).find((s) => s.name.toLowerCase() === "summary")?.body ?? "") : "";
  const layers = Object.entries(readSummary(change).layers).map(([n, r]) => `- ${n}: ${r.status}${r.review ? ` (review: ${r.review.verdict})` : ""}`);
  const deploy = lastDeploy(change);
  const shots = join(change.dir, "delivery", "screenshots");
  const taskRows = tasks.map((t) => `- ${t.id} ${String(t.title ?? "")} (${String(t.status ?? "pending")})`);
  const danger = mergeDanger(p, id, tasks, base, head);
  const where = rel(p, change.dir);
  const body = [
    // D12: three fixed sections first, in this order, "Nothing." when empty
    ...prSections(p, change, tasks),
    "## Summary",
    "",
    summary || String(change.data.title ?? id),
    "",
    "## Tasks",
    "",
    ...taskRows,
    "",
    "## Evidence",
    "",
    ...(layers.length ? layers : ["- no quality layers recorded"]),
    ...(deploy?.url ? [`- preview: ${deploy.url}${deploy.ok ? "" : " (deploy failed)"}`] : []),
    ...(existsSync(shots) ? [`- screenshots: ${where}/delivery/screenshots/`] : []),
    `- full evidence: ${where}/evidence/ and delivery/quality-report.md`,
    "",
    "## Merge danger",
    "",
    ...(danger.length ? danger.map((d) => `- ${d}`) : ["None found: no migrations, dependency or environment changes, no breaking tasks."]),
    "",
  ].join("\n");
  const bodyFile = join(p.run, `pr-${id}.md`);
  const draft = !readiness.ready;
  const commands = [
    `git push -u ${remote} ${head}`,
    `gh pr create --base ${base} --head ${head} --title "${title}" --body-file ${rel(p, bodyFile)}${repo ? ` --repo ${repo}` : ""}${draft ? " --draft" : ""}`,
  ];
  // the gate's own rule (src/grants.ts): does `aidw pr <id> --create` pass without asking right now?
  const granted = pushGrantReason(p, `aidw pr ${id} --create`, GRANT_STATES, p.project, opts.env ?? process.env) !== null;
  return { title, body, head, base, remote, repo, bodyFile, commands, ready: readiness.ready, why: readiness.why, granted, record: prRecord(change) };
}

/**
 * Writes the body file (and keeps the discarded work of not-built tasks in the Change); for a delivered Change whose
 * pull request is not open yet, records that its body is written (`run.pr`, url null), so the runner can end the run
 * with a NEXT for the user instead of waiting for a push nobody can approve.
 */
export function writePrBody(p: Paths, id: string, opts: { base?: string; env?: NodeJS.ProcessEnv } = {}): PrPlan {
  const change = loadAny(p, id);
  keepDiscardedWork(p, change, parseTasks(readText(join(change.dir, "tasks.yaml")) ?? "").tasks);
  const plan = planPr(p, id, opts);
  mkdirSync(p.run, { recursive: true });
  writeFileSync(plan.bodyFile, plan.body);
  if (stateOf(change) === "delivered" && !plan.record?.url) {
    const fresh = loadAny(p, id);
    savePrRecord(fresh, { url: null, draft: !plan.ready, at: new Date().toISOString() });
    plan.record = prRecord(fresh);
  }
  return plan;
}

/** What the lead (or the user) does after `aidw pr`: the NEXT line. */
export function prNext(p: Paths, id: string, plan: PrPlan, runner: boolean): string {
  const create = `aidw pr ${id} --create${plan.ready ? "" : " --draft"}`;
  const after = plan.ready ? `then \`aidw archive ${id}\`` : `do not archive: the draft stays open until \`/aidw:resume ${id}\` finishes it`;
  if (plan.record?.url) return `NEXT: \`aidw pr ${id} --create\` pushes again and updates ${plan.record.url}${plan.granted ? " (granted at the Approval Gate: it does not ask)" : " (it asks: the push was not granted)"}; ${after}`;
  if (plan.granted) return `NEXT: \`${create}\` (granted at the Approval Gate: it does not ask); ${after}`;
  if (runner) {
    return `NEXT: the push was not granted at the Approval Gate and nobody is here to answer, so the pull request is not opened: the user opens it with \`${create}\` (it asks), body in ${rel(p, plan.bodyFile)}; ${after}`;
  }
  return `NEXT: \`${create}\` (it asks you first: the push was not granted at the Approval Gate); ${after}`;
}

/**
 * Pushes the Change Branch and opens its pull request, ready or draft (D12), before the archive so the push grant still
 * covers the Change (ADR-0012). The delivery package is committed first, so the branch carries it. A pull request
 * already opened for the Change is updated instead: the branch pushed again, the body replaced, and marked ready when
 * the Change now is (/aidw:resume finished a draft).
 */
export function createPr(p: Paths, id: string, opts: { base?: string; draft?: boolean; env?: NodeJS.ProcessEnv } = {}): { url: string; plan: PrPlan; draft: boolean; updated: boolean } {
  const change = loadAny(p, id);
  const st = stateOf(change);
  if (st !== "delivered" && st !== "archived") throw new OpError(`change "${id}" is "${String(st)}"; open the PR after delivery`);
  const plan = writePrBody(p, id, opts);
  if (!git(p.project, ["remote", "get-url", plan.remote]).ok) throw new OpError(`no git remote named ${plan.remote}: add one (git remote add ${plan.remote} <url>) and run this again`);
  if (st === "delivered") commitAidw(p, aidwCommitMessage(`${id} pull request`, `Evidence: ${rel(p, change.dir)}/delivery/`), { delivery: true });
  const push = git(p.project, ["push", "-u", plan.remote, plan.head]);
  if (!push.ok) throw new OpError(`git push failed: ${(push.err || push.out).split("\n")[0]}`);
  const draft = opts.draft === true || !plan.ready;
  const prev = plan.record;
  let url: string;
  if (prev?.url) {
    url = prev.url;
    gh(p, plan, ["pr", "edit", url, "--body-file", plan.bodyFile]);
    if (prev.draft && !draft) gh(p, plan, ["pr", "ready", url]);
    else if (!prev.draft && draft) gh(p, plan, ["pr", "ready", url, "--undo"]);
  } else url = ghCreate(p, plan, draft);
  savePrRecord(loadAny(p, id), { url, draft, at: new Date().toISOString() });
  return { url, plan, draft, updated: Boolean(prev?.url) };
}

function gh(p: Paths, plan: PrPlan, args: string[]): string {
  const r = spawnSync("gh", [...args, ...(plan.repo ? ["--repo", plan.repo] : [])], { cwd: p.project, encoding: "utf8" });
  if (r.error || r.status !== 0) throw new OpError(`gh ${args.slice(0, 2).join(" ")} failed: ${(r.stderr || String(r.error ?? "")).trim().split("\n")[0]} (the branch is pushed; the body is in ${rel(p, plan.bodyFile)})`);
  return r.stdout.trim();
}

function ghCreate(p: Paths, plan: PrPlan, draft: boolean): string {
  const r = spawnSync("gh", ["pr", "create", "--base", plan.base, "--head", plan.head, "--title", plan.title, "--body-file", plan.bodyFile, ...(plan.repo ? ["--repo", plan.repo] : []), ...(draft ? ["--draft"] : [])], { cwd: p.project, encoding: "utf8" });
  if (r.error || r.status !== 0) throw new OpError(`gh pr create failed: ${(r.stderr || String(r.error ?? "")).trim().split("\n")[0]} (the branch is pushed; open the PR by hand with the body in ${rel(p, plan.bodyFile)})`);
  return r.stdout.trim().split("\n").pop() ?? "";
}
