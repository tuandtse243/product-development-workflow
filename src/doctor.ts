/**
 * `aidw doctor [<id>]`: everything the unattended run needs from the machine, checked once up front instead of
 * failing mid-run. Every check here comes from a failure seen in trial-3A: a missing binary, a package store the
 * sandbox cannot write, an unlinked Vercel project (the first deploy is then Production), a closed CDP port.
 */
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadChange } from "./change.js";
import { readBrowser } from "./browser.js";
import { claudeHome } from "./cost.js";
import { isDefaultBranch } from "./ops.js";
import { git, isGitRepo } from "./git.js";
import { installProblem, installStatus, type ShellRun } from "./installcheck.js";
import { readText, type Paths } from "./project.js";
import { parseQuality, qualityFile, type QualityConfig } from "./quality.js";

export type CheckStatus = "ok" | "warn" | "fail";
export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

/** Runs a command and reports success and its combined output. Injected in tests. */
export type Probe = (cmd: string, args: string[], cwd: string, timeoutMs?: number) => { ok: boolean; out: string };

export const shellProbe: Probe = (cmd, args, cwd, timeoutMs = 15_000) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: timeoutMs });
  return { ok: r.status === 0 && !r.error, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
};

const SHELL_WORDS = new Set(["!", "cd", "echo", "test", "[", "true", "false", "export", "set", "exit", "sh", "bash", "git"]);
const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun"];

/** First real program of a layer command: skips `VAR=value` prefixes and shell words. */
export function binaryOf(command: string): { bin: string; sub?: string } | null {
  const words = command.trim().split(/\s+/).filter((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
  const bin = (words[0] ?? "").replace(/^["'(]+/, "");
  if (!bin || SHELL_WORDS.has(bin)) return null;
  // `pnpm exec vitest ...` / `npx vitest`: the tool is the real dependency
  if (PACKAGE_MANAGERS.includes(bin) && words[1] === "exec" && words[2]) return { bin, sub: words[2] };
  if (bin === "npx" && words[1]) return { bin, sub: words.slice(1).find((w) => !w.startsWith("-")) };
  return { bin };
}

const commandsOf = (q: QualityConfig): string[] => [...q.layers.flatMap((l) => [...l.setup, ...l.run]), ...(q.deploy.command ? [q.deploy.command] : []), ...q.deploy.smoke];

export const drivesBrowser = (q: QualityConfig): boolean => q.layers.some((l) => ["e2e", "a11y", "ui-ux"].includes(l.name) || l.run.some((c) => /playwright|cypress/i.test(c)));

function writable(path: string): boolean {
  let dir = path;
  while (!existsSync(dir)) {
    const up = dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Names of the enabled plugins other than aidw, from the user's settings.json (read only). */
export function otherPlugins(env: NodeJS.ProcessEnv): string[] {
  try {
    const s = JSON.parse(readFileSync(join(claudeHome(env), "settings.json"), "utf8")) as { enabledPlugins?: Record<string, unknown> };
    return Object.entries(s.enabledPlugins ?? {})
      .filter(([name, on]) => on === true && !/^aidw(@|$)/.test(name))
      .map(([name]) => name.split("@")[0] as string);
  } catch {
    return [];
  }
}

const FRAMEWORKS: { dep: string; id: string }[] = [
  { dep: "next", id: "nextjs" },
  { dep: "nuxt", id: "nuxtjs" },
  { dep: "@sveltejs/kit", id: "sveltekit-1" },
  { dep: "astro", id: "astro" },
  { dep: "vite", id: "vite" },
];

function frameworkOf(root: string): { dep: string; id: string } | null {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return FRAMEWORKS.find((f) => f.dep in deps) ?? null;
  } catch {
    return null;
  }
}

function vercelJsonFramework(root: string): boolean {
  try {
    return typeof (JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as { framework?: unknown }).framework === "string";
  } catch {
    return false;
  }
}

/** `install` makes the check install a real package (a few seconds to minutes); tests and plain library use leave it out. */
export interface InstallOptions {
  run: ShellRun;
  fresh?: boolean;
}

export function doctor(p: Paths, id: string | null, env: NodeJS.ProcessEnv = process.env, probe: Probe = shellProbe, install?: InstallOptions): Check[] {
  const out: Check[] = [];
  const add = (name: string, status: CheckStatus, detail: string) => out.push({ name, status, detail });

  const major = Number(/^v?(\d+)/.exec(process.version)?.[1] ?? 0);
  add("node", major >= 20 ? "ok" : "fail", `${process.version}${major >= 20 ? "" : " (aidw needs Node 20 or newer)"}`);

  let quality: QualityConfig | null = null;
  if (id) {
    const change = loadChange(p, id);
    const text = readText(qualityFile(change));
    if (text !== null) {
      const parsed = parseQuality(text, "quality.yaml");
      quality = parsed.config;
      // An invalid file must not look like a clean one: without it no layer, browser or deploy check runs.
      if (parsed.diags.errors.length) {
        add("quality.yaml", "fail", `${parsed.diags.errors.map((e) => e.message).join("; ")} (nothing else can be checked until this is fixed)`);
      }
    } else add("quality.yaml", "warn", "missing: nothing to check beyond the machine");
  }

  if (isGitRepo(p.project)) {
    const dirty = git(p.project, ["status", "--porcelain", "--", ".", ":(exclude).aidw"]).out;
    const branch = git(p.project, ["branch", "--show-current"]).out;
    add("git tree", dirty ? "warn" : "ok", dirty ? `uncommitted changes outside .aidw/ would end up in task commits (${dirty.split("\n").length} file(s)): commit or stash them` : "clean");
    if (id) {
      const onDefault = isDefaultBranch(p.project, branch);
      add("git branch", "ok", onDefault ? `${branch || "detached HEAD"}: aidw switches to its change branch when execution starts` : branch);
    }
  } else {
    add("git", "warn", "not a git repository: tasks will not be committed");
  }

  const heavy = otherPlugins(env);
  if (heavy.length >= 3) {
    add("token overhead", "warn", `${heavy.length} other plugins are enabled (${heavy.slice(0, 4).join(", ")}${heavy.length > 4 ? ", ..." : ""}): their tools and hook text ride along in every turn of every subagent (trial-3A: 37K tokens in an implementer's first turn against 9K for a reviewer). Use \`aidw run\` (it drops MCP servers) or disable them for the run`);
  }

  if (!quality) return out;

  // package manager and the binaries the layers run
  const cmds = commandsOf(quality);
  const pm = PACKAGE_MANAGERS.find((m) => cmds.some((c) => binaryOf(c)?.bin === m));
  if (pm) {
    const v = probe(pm, ["--version"], p.project);
    add(pm, v.ok ? "ok" : "fail", v.ok ? v.out.split("\n")[0] ?? "" : `not runnable: ${v.out.split("\n")[0] ?? "command not found"}`);
  }
  const seen = new Set<string>(pm ? [pm] : []);
  const hasModules = existsSync(join(p.project, "node_modules"));
  for (const c of cmds) {
    const b = binaryOf(c);
    if (!b) continue;
    const key = b.sub ? `${b.bin} ${b.sub}` : b.bin;
    if (seen.has(key)) continue;
    seen.add(key);
    if (b.sub) {
      // a dependency of the project: only checkable once it is installed
      if (!hasModules) add(key, "ok", "installed by the scaffold task (no node_modules yet)");
      else add(key, existsSync(join(p.project, "node_modules", ".bin", b.sub)) ? "ok" : "warn", existsSync(join(p.project, "node_modules", ".bin", b.sub)) ? "in node_modules/.bin" : "not in node_modules/.bin");
      continue;
    }
    const w = probe("which", [b.bin], p.project);
    add(b.bin, w.ok ? "ok" : "fail", w.ok ? w.out : `not found on PATH (a layer or the deploy runs \`${c.slice(0, 60)}\`)`);
  }

  // installs: a writable store and a reachable registry (trial-3A lost 77 minutes here)
  if (pm === "pnpm" && !hasModules) {
    const store = probe("pnpm", ["store", "path"], p.project);
    if (store.ok && store.out) add("pnpm store", writable(store.out.split("\n").pop() ?? store.out) ? "ok" : "warn", writable(store.out.split("\n").pop() ?? store.out) ? store.out : `${store.out} is not writable from here (sandbox): run the first \`pnpm install\` in your own terminal`);
  }
  if (pm && !hasModules) {
    const reg = probe("curl", ["-sSI", "-m", "8", "https://registry.npmjs.org/"], p.project, 12_000);
    add("npm registry", reg.ok ? "ok" : "warn", reg.ok ? "reachable" : "not reachable from here: installs will fail until the network is allowed");
  }
  if (pm && !hasModules && install) {
    // A reachable registry proves little: a package scanner that wraps the install can still time out (notes-app run).
    const r = installStatus(p, pm, install.run, { fresh: install.fresh });
    add("package install", r.status === "ok" ? "ok" : r.status === "flaky" ? "warn" : "fail", r.status === "fail" ? installProblem(r, id) : r.detail);
  }

  if (drivesBrowser(quality)) {
    // No fixed port: the endpoint is the one the user set, or the project's own test browser (`aidw browser start`).
    const url = env.E2E_CDP_URL ?? readBrowser(p)?.url;
    if (!url) {
      add("chrome cdp", "fail", "no test browser for this project: run `aidw browser start` (it picks a free port; in your own terminal when the sandbox blocks launching Chrome)");
    } else {
      const r = probe("curl", ["-sS", "-m", "5", `${url}/json/version`], p.project, 8_000);
      const up = r.ok && /Browser/.test(r.out);
      add("chrome cdp", up ? "ok" : "fail", up ? url : `${url} does not answer: run \`aidw browser start\` (see roles/qa/references/quality-layers.md)`);
    }
  }

  if (quality.deploy.target !== "none" && /\bvercel\b/.test(quality.deploy.command ?? "")) {
    // `vercel whoami` is not read-only: with an expired token the CLI refreshes it and, when the refresh fails,
    // logs out by deleting its auth file. A failure here can therefore leave the user logged out.
    const who = probe("vercel", ["whoami"], p.project, 20_000);
    add("vercel login", who.ok ? "ok" : "fail", who.ok ? who.out.split("\n").pop() ?? "" : `${who.out.split("\n").pop() ?? "not logged in"}: run \`vercel login\` in your own terminal and allow vercel.com and *.vercel.com in the sandbox`);
    const linked = existsSync(join(p.project, ".vercel", "project.json"));
    add("vercel project", linked ? "ok" : "warn", linked ? "linked" : "not linked: the first deploy would be Production (tier 3). Run `vercel link --yes` first");
    // trial-3C: `vercel link` ran in an empty folder, so the project was saved with preset "Other" and the Next.js build
    // failed with STATIC_BUILD_NO_OUT_DIR. A committed vercel.json with the framework overrides the saved preset.
    const framework = frameworkOf(p.project);
    if (linked && framework && !vercelJsonFramework(p.project)) {
      add("vercel framework", "warn", `package.json uses ${framework.dep} but vercel.json does not set "framework": "${framework.id}". A project linked before the scaffold exists is saved as "Other" and fails with STATIC_BUILD_NO_OUT_DIR. Commit vercel.json with {"framework": "${framework.id}"}`);
    }
    if (linked && who.ok) {
      // trial-3C: a linked project with no deployment yet cannot take a preview: the first one is always Production
      const ls = probe("vercel", ["ls"], p.project, 30_000);
      if (ls.ok && /no deployments found/i.test(ls.out)) {
        add("vercel deployments", "fail", "none yet, and a project's first deployment is Production (tier 3, a decision for you): the preview deploy will fail. Run `aidw first-deploy --yes` in your own terminal (it deploys the app publicly, once), or set the deploy target to none");
      }
    }
  }
  return out;
}

export function doctorText(checks: Check[]): string {
  const mark = { ok: "ok  ", warn: "WARN", fail: "FAIL" } as const;
  const bad = checks.filter((c) => c.status === "fail").length;
  const warn = checks.filter((c) => c.status === "warn").length;
  return `${checks.map((c) => `${mark[c.status]} ${c.name}: ${c.detail}`).join("\n")}\n${bad ? `${bad} problem(s) to fix before the run` : warn ? `no blocking problem, ${warn} warning(s)` : "all checks pass"}\n`;
}
