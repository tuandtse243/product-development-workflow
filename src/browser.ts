/**
 * The test browser of a project: a Chrome that aidw starts for the e2e, a11y, ui-ux and performance layers.
 *
 * It never uses a fixed port. Chrome is started with `--remote-debugging-port=0`, picks a free port itself and
 * writes it to `DevToolsActivePort` in its profile; the endpoint is recorded in `.aidw/run/browser.json`, and
 * every command aidw runs for a layer or a checkpoint gets it as `E2E_CDP_URL` and `E2E_CDP_PORT`. Each project
 * has its own profile, so two projects get two browsers and never meet in the same one, and the user's own
 * Chrome (or another tool on 9222) is never connected to by accident.
 *
 * Playwright's browser launch is usually blocked by the Claude Code sandbox, which is why a Chrome started
 * outside it and reached over CDP is used at all (roles/qa/references/quality-layers.md, "E2E browser over CDP").
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Paths } from "./project.js";

export interface BrowserRecord {
  port: number;
  url: string;
  pid: number;
  profile: string;
  headless: boolean;
  started_at: string;
}

export const browserFile = (p: Paths) => join(p.run, "browser.json");

export function readBrowser(p: Paths): BrowserRecord | null {
  try {
    const r = JSON.parse(readFileSync(browserFile(p), "utf8")) as Partial<BrowserRecord>;
    return typeof r.port === "number" && typeof r.url === "string" && typeof r.pid === "number" ? (r as BrowserRecord) : null;
  } catch {
    return null;
  }
}

/**
 * Is `E2E_CDP_URL` the user's own browser? `aidw` copies the URL it recorded into the environment of every command, so
 * only a URL that is not the recorded one was set by the user. A recorded URL that has gone stale must not stop `run`
 * from starting a browser.
 */
export const usesOwnBrowser = (env: NodeJS.ProcessEnv, p: Paths): boolean => !!env.E2E_CDP_URL && env.E2E_CDP_URL !== readBrowser(p)?.url;

/** The environment the layer commands get so their browser fixture finds the test browser. */
export function browserEnv(p: Paths): Record<string, string> {
  const r = readBrowser(p);
  return r ? { E2E_CDP_URL: r.url, E2E_CDP_PORT: String(r.port) } : {};
}

/** Where this project's Chrome keeps its profile: one directory per project, outside the repository. */
export const profileDir = (p: Paths, home = homedir()) => join(home, ".aidw-chrome", createHash("sha1").update(p.project).digest("hex").slice(0, 10));

/**
 * The profile directory to use: the one under the home directory, or, when that is not writable (the Claude Code
 * sandbox only allows the project and the temp dir), one under the system temp dir. A test browser needs no profile
 * that outlives the machine's next cleanup.
 */
function usableProfile(p: Paths, home: string, tmp: string): string {
  for (const dir of [profileDir(p, home), join(tmp, "aidw-chrome", createHash("sha1").update(p.project).digest("hex").slice(0, 10))]) {
    try {
      mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      /* try the next place */
    }
  }
  throw new BrowserError("cannot create a browser profile under the home directory or the temp directory");
}

/** Everything the browser commands need from the machine, injectable in tests. */
export interface BrowserDeps {
  /** does a Chrome answer at this endpoint? returns its `Browser` string */
  probe: (url: string) => string | null;
  /** starts Chrome detached, its output going to `log`, and returns its pid */
  launch: (bin: string, args: string[], log: string) => number | null;
  /** is this process alive? */
  alive: (pid: number) => boolean;
  /** ends the process; false when this process is not allowed to (a sandboxed session cannot signal Chrome) */
  kill: (pid: number) => boolean;
  sleep: (ms: number) => void;
  /** the Chrome binary to use, or null */
  chrome: (env: NodeJS.ProcessEnv) => string | null;
  home: string;
  /** where to fall back to when the home directory is not writable */
  tmp?: string;
}

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export const realBrowserDeps: BrowserDeps = {
  probe: (url) => {
    const r = spawnSync("curl", ["-sS", "-m", "3", `${url}/json/version`], { encoding: "utf8", timeout: 6_000 });
    if (r.status !== 0) return null;
    try {
      const b = (JSON.parse(r.stdout) as { Browser?: string }).Browser;
      return typeof b === "string" ? b : null;
    } catch {
      return null;
    }
  },
  launch: (bin, args, log) => {
    const fd = openSync(log, "w");
    try {
      const child = spawn(bin, args, { detached: true, stdio: ["ignore", fd, fd] });
      let failed = false;
      child.on("error", () => {
        failed = true;
      });
      child.unref();
      return failed ? null : (child.pid ?? null);
    } finally {
      closeSync(fd);
    }
  },
  alive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "EPERM"; // it exists, this process may not signal it
    }
  },
  kill: (pid) => {
    try {
      process.kill(pid, "SIGTERM");
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code !== "EPERM"; // ESRCH: already gone
    }
  },
  sleep: (ms) => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  chrome: (env) => (env.AIDW_CHROME ? env.AIDW_CHROME : (CHROME_CANDIDATES.find((c) => existsSync(c)) ?? null)),
  home: homedir(),
};

export class BrowserError extends Error {}

export interface BrowserStatus {
  running: boolean;
  record: BrowserRecord | null;
  browser?: string;
  /** why it is not running, when a record exists */
  stale?: string;
}

export function browserStatus(p: Paths, deps: BrowserDeps = realBrowserDeps): BrowserStatus {
  const record = readBrowser(p);
  if (!record) return { running: false, record: null };
  const browser = deps.probe(record.url);
  if (browser) return { running: true, record, browser };
  return { running: false, record, stale: deps.alive(record.pid) ? `pid ${record.pid} is alive but ${record.url} does not answer` : `pid ${record.pid} has exited` };
}

/** The port Chrome chose, once it has written it to its profile. */
function activePort(profile: string): number | null {
  try {
    const first = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0] ?? "";
    const n = Number(first.trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Starts the project's test browser (or reports the one that is running). Headless by default: a test browser
 * should not take over the user's screen; `headed` shows the window.
 */
export function startBrowser(p: Paths, opts: { headed?: boolean; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}, deps: BrowserDeps = realBrowserDeps): BrowserStatus & { started: boolean } {
  const current = browserStatus(p, deps);
  if (current.running) return { ...current, started: false };

  const bin = deps.chrome(opts.env ?? process.env);
  if (!bin) throw new BrowserError("no Chrome found: install Google Chrome or Chromium, or set AIDW_CHROME to its binary");

  const profile = usableProfile(p, deps.home, deps.tmp ?? tmpdir());
  // A crashed Chrome leaves its old port behind; reading it would point at nothing.
  try {
    rmSync(join(profile, "DevToolsActivePort"), { force: true });
  } catch {
    /* not writable from here: Chrome overwrites it when it starts */
  }
  if (current.record && deps.alive(current.record.pid)) {
    // a leftover Chrome that no longer answers; if it cannot be signalled from here, a second Chrome would fight for the profile
    if (!deps.kill(current.record.pid)) throw new BrowserError(`pid ${current.record.pid} is still running but does not answer, and this session may not stop it: run \`aidw browser stop\` in your own terminal`);
  }

  const headless = !opts.headed;
  const args = [
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(headless ? ["--headless=new"] : []),
    "about:blank",
  ];
  const log = join(profile, "chrome.log");
  const pid = deps.launch(bin, args, log);
  if (pid === null) throw new BrowserError(`could not start ${bin}: the sandbox may block launching a browser; run \`aidw browser start\` in your own terminal`);

  const deadline = (opts.timeoutMs ?? 20_000) / 250;
  for (let i = 0; i < deadline; i++) {
    const port = activePort(profile);
    if (port) {
      const url = `http://127.0.0.1:${port}`;
      const browser = deps.probe(url);
      if (browser) {
        const record: BrowserRecord = { port, url, pid, profile, headless, started_at: new Date().toISOString() };
        mkdirSync(p.run, { recursive: true });
        writeFileSync(browserFile(p), `${JSON.stringify(record, null, 2)}\n`);
        return { running: true, record, browser, started: true };
      }
    }
    if (!deps.alive(pid)) break;
    deps.sleep(250);
  }
  if (deps.alive(pid)) deps.kill(pid);
  throw new BrowserError(`Chrome did not open a debugging port.${whyChromeFailed(log)} Run \`aidw browser start\` in your own terminal (profile ${profile}, log ${log}).`);
}

/** One sentence on why Chrome stopped, from its own log: the sandbox, a profile in use, or the last error line. */
function whyChromeFailed(log: string): string {
  let text = "";
  try {
    text = readFileSync(log, "utf8");
  } catch {
    return "";
  }
  if (/Permission denied|Operation not permitted|bootstrap_check_in/.test(text)) return " The sandbox of this session does not let Chrome start (macOS denies it registering its processes).";
  if (/ProcessSingleton|profile directory/.test(text)) return " Another Chrome is using this profile: close it.";
  const last = text.split("\n").map((l) => l.trim()).filter(Boolean).pop();
  return last ? ` Chrome said: ${last.slice(0, 160)}` : "";
}

/**
 * Stops the project's test browser and forgets it. "none": there was none. "denied": it is running but this process
 * may not signal it (a sandboxed session); the record is kept so it is not lost, and the user stops it themselves.
 */
export function stopBrowser(p: Paths, deps: BrowserDeps = realBrowserDeps): "stopped" | "none" | "denied" {
  const record = readBrowser(p);
  if (!record) return "none";
  if (deps.alive(record.pid) && !deps.kill(record.pid)) return "denied";
  rmSync(browserFile(p), { force: true });
  try {
    rmSync(join(record.profile, "DevToolsActivePort"), { force: true });
  } catch {
    /* the profile may be outside what this process can write (a sandboxed session); the port is ignored on the next start anyway */
  }
  return "stopped";
}
