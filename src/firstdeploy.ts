/**
 * `aidw first-deploy [<id>] --yes`: the one Production deployment a new Vercel project needs before any preview works
 * (trial-3C). It is a tier-3 decision (the app becomes public), so it needs the user's explicit `--yes`, the gate asks
 * when an agent tries it, and a subagent never runs it.
 */
import { spawnSync } from "node:child_process";
import { loadChange } from "./change.js";
import { OpError } from "./ops.js";
import { readText, type Paths } from "./project.js";
import { parseQuality, qualityFile } from "./quality.js";

export interface FirstDeploy {
  command: string;
  needed: boolean;
  ran: boolean;
  ok: boolean;
  output: string;
}

/** The deploy command turned into its Production form: the preview flag becomes `--prod`. */
export function productionCommand(command: string): string {
  const swapped = command.replace(/\s--(?:environment|target)(?:=|\s+)preview\b/, " --prod");
  return /\s--prod\b/.test(swapped) ? swapped : `${swapped} --prod`;
}

export function firstDeploy(p: Paths, id: string, yes: boolean, run: typeof spawnSync = spawnSync): FirstDeploy {
  const text = readText(qualityFile(loadChange(p, id)));
  const q = text === null ? null : parseQuality(text, "quality.yaml").config;
  if (!q?.deploy.command || !/\bvercel\b/.test(q.deploy.command)) throw new OpError("first-deploy is for Vercel projects: quality.yaml has no vercel deploy command");
  const command = productionCommand(q.deploy.command);
  const ls = run("vercel", ["ls"], { cwd: p.project, encoding: "utf8", timeout: 30_000 });
  const out = `${ls.stdout ?? ""}${ls.stderr ?? ""}`;
  if (ls.status !== 0 && !/no deployments found/i.test(out)) throw new OpError(`cannot list the Vercel deployments (${out.trim().split("\n").pop() ?? "vercel failed"}): run \`vercel login\` and \`vercel link --yes\` first`);
  const needed = /no deployments found/i.test(out);
  if (!needed) return { command, needed, ran: false, ok: true, output: "the project already has a deployment: previews work, nothing to do" };
  if (!yes) return { command, needed, ran: false, ok: false, output: `this deploys the app to PRODUCTION (public URL, no login in front of it unless you added one).\nIf that is fine, run: aidw first-deploy ${id} --yes\nThe command will be: ${command}` };
  const r = run("sh", ["-c", command], { cwd: p.project, encoding: "utf8", timeout: 20 * 60_000, maxBuffer: 16 * 1024 * 1024 });
  return { command, needed, ran: true, ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-12).join("\n") };
}
