/**
 * `aidw pr`: an opt-in pull request at delivery (docs/roadmap.md). The body is built from primary sources (the
 * Analysis summary, task commits, quality and deploy evidence, the diff), never from an LLM summary. Pushing and
 * opening the PR is tier 3 (the gate asks for `aidw pr --create`) unless the Approval Gate granted it (src/grants.ts).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { ChangeError, loadChange, stateOf, type Change } from "./change.js";
import { header, scopeOf } from "./commit.js";
import { readGrants } from "./grants.js";
import { lastDeploy, readSummary } from "./quality.js";
import { git } from "./git.js";
import { OpError } from "./ops.js";
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
  bodyFile: string;
  commands: string[];
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

export function planPr(p: Paths, id: string, opts: { base?: string } = {}): PrPlan {
  const change = loadAny(p, id);
  const run = (change.data.run ?? {}) as { branch?: string; base_branch?: string };
  const head = run.branch ?? `aidw/${id}`;
  const grant = readGrants(change).push;
  const base = opts.base ?? grant?.base ?? run.base_branch ?? "main";
  const remote = grant?.remote ?? "origin";
  const tasks = parseTasks(readText(join(change.dir, "tasks.yaml")) ?? "").tasks;
  const planned = tasks.filter((t) => !t.origin);
  const allFix = planned.length > 0 && planned.every((t) => t.type === "fix");
  const first = planned[0];
  const title = header(allFix ? "fix" : "feat", first ? scopeOf(first) : "config", String(change.data.title ?? id));

  const analysis = readText(join(change.dir, "analysis.md"));
  const summary = analysis ? (sections(analysis).find((s) => s.name.toLowerCase() === "summary")?.body ?? "") : "";
  const layers = Object.entries(readSummary(change).layers).map(([n, r]) => `- ${n}: ${r.status}${r.review ? ` (review: ${r.review.verdict})` : ""}`);
  const deploy = lastDeploy(change);
  const shots = join(change.dir, "delivery", "screenshots");
  const taskRows = tasks.map((t) => `- ${t.id} ${String(t.title ?? "")} (${String(t.status ?? "pending")})`);
  const danger = mergeDanger(p, id, tasks, base, head);
  const body = [
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
    ...(existsSync(shots) ? ["- screenshots: .aidw/changes/" + id + "/delivery/screenshots/"] : []),
    `- full evidence: .aidw/changes/${id}/evidence/ and delivery/quality-report.md`,
    "",
    "## Merge danger",
    "",
    ...(danger.length ? danger.map((d) => `- ${d}`) : ["None found: no migrations, dependency or environment changes, no breaking tasks."]),
    "",
  ].join("\n");
  const bodyFile = join(p.run, `pr-${id}.md`);
  const commands = [`git push -u ${remote} ${head}`, `gh pr create --base ${base} --head ${head} --title "${title}" --body-file ${rel(p, bodyFile)}`];
  return { title, body, head, base, remote, bodyFile, commands };
}

/** Pushes the change branch and opens the PR. Only after delivery, and only with a remote and the GitHub CLI. */
export function createPr(p: Paths, id: string, opts: { base?: string; draft?: boolean } = {}): { url: string; plan: PrPlan } {
  const change = loadAny(p, id);
  const st = stateOf(change);
  if (st !== "delivered" && st !== "archived") throw new OpError(`change "${id}" is "${String(st)}"; open the PR after delivery`);
  const plan = planPr(p, id, opts);
  if (!git(p.project, ["remote", "get-url", plan.remote]).ok) throw new OpError(`no git remote named ${plan.remote}: add one (git remote add ${plan.remote} <url>) and run this again`);
  mkdirSync(p.run, { recursive: true });
  writeFileSync(plan.bodyFile, plan.body);
  const push = git(p.project, ["push", "-u", plan.remote, plan.head]);
  if (!push.ok) throw new OpError(`git push failed: ${(push.err || push.out).split("\n")[0]}`);
  const r = ghCreate(p, plan, opts.draft === true);
  return { url: r, plan };
}

function ghCreate(p: Paths, plan: PrPlan, draft: boolean): string {
  const r = spawnSync("gh", ["pr", "create", "--base", plan.base, "--head", plan.head, "--title", plan.title, "--body-file", plan.bodyFile, ...(draft ? ["--draft"] : [])], { cwd: p.project, encoding: "utf8" });
  if (r.error || r.status !== 0) throw new OpError(`gh pr create failed: ${(r.stderr || String(r.error ?? "")).trim().split("\n")[0]} (the branch is pushed; open the PR by hand with the body in ${rel(p, plan.bodyFile)})`);
  return r.stdout.trim().split("\n").pop() ?? "";
}
