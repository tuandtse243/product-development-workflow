/**
 * Can this machine install packages? Checked before a run starts, not found out by an implementer.
 *
 * Seen on a real run (a notes app from an empty folder): every doctor check passed, then the scaffold task's first
 * `npm install` failed in 10 seconds because a package security scanner (safe-chain) wraps `npm` in the user's shell
 * and timed out downloading its malware list. The registry was reachable, so the old "registry" check said ok. Each
 * time the user changed a setting, the only way to learn whether it had worked was to spawn a whole implementer
 * (about two minutes and its tokens) and watch it fail again.
 *
 * So the probe installs one tiny package into a scratch folder, through the user's interactive shell (a node child
 * process would skip the shell function that wraps `npm`, and pass). It retries, because the scanner's timeout is
 * intermittent: passing on the second try is reported as `flaky`, a warning, not as a failure. The result is kept in
 * `.aidw/run/install-probe.json`; `aidw doctor` shows it and `aidw transition <id> executing` refuses to start
 * the build while it fails.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Paths } from "./project.js";

export interface ShellResult {
  ok: boolean;
  out: string;
  timedOut: boolean;
}
/** Runs one command line in a folder. Injected in tests. */
export type ShellRun = (command: string, cwd: string, timeoutMs: number) => ShellResult;

/** Runs the command the way a developer's terminal does, so a shell function that wraps `npm` applies. */
export const interactiveShell: ShellRun = (command, cwd, timeoutMs) => {
  const shell = process.env.SHELL && existsSync(process.env.SHELL) ? process.env.SHELL : "/bin/sh";
  const args = /\/(zsh|bash)$/.test(shell) ? ["-ic", command] : ["-c", command];
  const r = spawnSync(shell, args, { cwd, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
  return { ok: r.status === 0 && !r.error, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim(), timedOut: (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" };
};

let runner: ShellRun = interactiveShell;
/** Replaces the shell the guard uses (tests). */
export const useInstallRunner = (r: ShellRun): void => {
  runner = r;
};
export const installRunner = (): ShellRun => runner;

export const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun"];
const PROBE_PACKAGE = "is-number@7.0.0"; // 7 kB, no dependencies

/** The package manager the project's layer commands use (`npx` means npm), or null when none of them installs from npm. */
export function packageManagerOf(commands: string[]): string | null {
  for (const c of commands) {
    const first = c.trim().split(/\s+/).find((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w))?.replace(/^["'(]+/, "");
    if (first && PACKAGE_MANAGERS.includes(first)) return first;
    if (first === "npx") return "npm";
  }
  return null;
}

export const probeCommand = (pm: string): string =>
  pm === "pnpm" ? `pnpm add --ignore-scripts ${PROBE_PACKAGE}`
  : pm === "yarn" ? `yarn add --ignore-scripts ${PROBE_PACKAGE}`
  : pm === "bun" ? `bun add --ignore-scripts ${PROBE_PACKAGE}`
  : `npm install --ignore-scripts --no-audit --no-fund --no-package-lock ${PROBE_PACKAGE}`;

export interface InstallProbe {
  status: "ok" | "flaky" | "fail";
  pm: string;
  /** the try that passed, or the number of tries that all failed */
  attempts: number;
  tries: number;
  detail: string;
  at: string;
}

const recordFile = (p: Paths) => join(p.run, "install-probe.json");
const probeDir = (p: Paths) => join(p.run, "install-probe");
export const lastProbe = (p: Paths): InstallProbe | null => {
  try {
    const r = JSON.parse(readFileSync(recordFile(p), "utf8")) as Partial<InstallProbe>;
    return r.status && r.pm && typeof r.at === "string" ? (r as InstallProbe) : null;
  } catch {
    return null;
  }
};

/** The last output line that says something: shells print job-control noise first. */
function lastLine(out: string): string {
  const lines = out.split("\n").map((l) => l.trim()).filter((l) => l && !/job control|no controlling tty|tty process group|^\[?\d+\]? +\d+$/i.test(l));
  return (lines[lines.length - 1] ?? "no output").slice(0, 240);
}

const sleep = (ms: number) => {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

export function probeInstall(
  p: Paths,
  pm: string,
  run: ShellRun,
  o: { tries?: number; timeoutMs?: number; pauseMs?: number } = {},
): InstallProbe {
  const tries = o.tries ?? 3;
  const dir = probeDir(p);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "aidw-install-probe", private: true, version: "0.0.0" })}\n`);
  let result: InstallProbe | null = null;
  let last = "";
  try {
    for (let i = 1; i <= tries && !result; i++) {
      const r = run(probeCommand(pm), dir, o.timeoutMs ?? 90_000);
      if (r.ok) {
        result = { status: i === 1 ? "ok" : "flaky", pm, attempts: i, tries, at: new Date().toISOString(), detail: i === 1 ? `${pm} installed a test package` : `${pm} installed a test package on try ${i} of ${tries}: a package scanner or the network is slow here, so an install may need a retry` };
      } else {
        last = r.timedOut ? `no answer within ${Math.round((o.timeoutMs ?? 90_000) / 1000)} s` : lastLine(r.out);
        if (i < tries) sleep(o.pauseMs ?? Number(process.env.AIDW_INSTALL_PAUSE_MS ?? 5_000));
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  result ??= { status: "fail", pm, attempts: tries, tries, at: new Date().toISOString(), detail: last };
  mkdirSync(p.run, { recursive: true });
  writeFileSync(recordFile(p), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

/** A recent pass is reused (30 minutes); a failure, an old result or `fresh` runs the probe again. */
export function installStatus(
  p: Paths,
  pm: string,
  run: ShellRun,
  o: { fresh?: boolean; maxAgeMs?: number; now?: number; tries?: number; timeoutMs?: number; pauseMs?: number } = {},
): InstallProbe {
  const last = lastProbe(p);
  const age = (o.now ?? Date.now()) - (last ? Date.parse(last.at) : 0);
  if (!o.fresh && last && last.pm === pm && last.status !== "fail" && age >= 0 && age < (o.maxAgeMs ?? 30 * 60_000)) return last;
  return probeInstall(p, pm, run, o);
}

/** What to tell the user when packages cannot be installed from here. */
export function installProblem(r: InstallProbe, id?: string | null): string {
  return [
    `packages cannot be installed from here: \`${r.pm}\` failed ${r.tries} of ${r.tries} tries (${r.detail}).`,
    "This is the machine, not the code: no implementer can fix it, so do not start the build (or spawn another implementer) until it passes.",
    "Usual causes: a package security scanner (for example safe-chain) that times out downloading its list, a registry or proxy that is not reachable, a sandbox that denies the command.",
    `Fix it once, then check in about ten seconds with \`aidw doctor${id ? ` ${id}` : ""} --fresh\`: allow the install command outside the sandbox (/sandbox: \`excludedCommands\` or \`allowUnsandboxedCommands\`; when a command rewriter such as rtk prefixes it, allow the prefixed form too, \`rtk ${r.pm} install *\`), or warm the scanner's cache by running \`${r.pm} install\` once in your own terminal.`,
    `Shortest way out: run the build in your own terminal with \`aidw run${id ? ` ${id}` : ""} --detach\`; it runs in auto mode, where a command this sandbox blocks is run again outside it without waiting for you.`,
    "To skip this check, set AIDW_SKIP_INSTALL_CHECK=1.",
  ].join(" ");
}

/** `aidw transition <id> executing`: refused while packages cannot be installed. */
export function installGuard(p: Paths, id: string, layerCommands: string[], env: NodeJS.ProcessEnv = process.env, run: ShellRun = runner): string | null {
  if (env.AIDW_SKIP_INSTALL_CHECK === "1") return null;
  const pm = packageManagerOf(layerCommands);
  if (!pm || existsSync(join(p.project, "node_modules"))) return null; // nothing to install yet, or already installed
  const r = installStatus(p, pm, run);
  return r.status === "fail" ? `"executing" refused: ${installProblem(r, id)}` : null;
}
