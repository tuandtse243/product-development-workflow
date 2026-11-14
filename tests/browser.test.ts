import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BrowserError, browserEnv, browserFile, browserStatus, profileDir, readBrowser, startBrowser, stopBrowser, type BrowserDeps } from "../src/browser.js";
import { run } from "../src/cli.js";
import { pathsFor } from "../src/project.js";

const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "aidw-browser-"));
  temps.push(d);
  return d;
};
function project() {
  const root = tmp();
  run(["init", "--root", root], {}, root, { out: () => {}, err: () => {} });
  return { root, p: pathsFor(root), home: tmp() };
}

/** A Chrome that "opens" a random-looking free port and answers on it until killed. */
function fakeChrome(home: string, opts: { port?: number; crash?: boolean; noPort?: boolean; sandboxed?: boolean } = {}) {
  const state = { running: new Set<number>(), launched: [] as string[][], killed: [] as number[], pid: 4000, port: opts.port ?? 43117 };
  const deps: BrowserDeps = {
    home,
    chrome: () => "/fake/chrome",
    probe: (url) => (state.running.has(Number(new URL(url).port)) ? "Chrome/999" : null),
    launch: (_bin, args, log) => {
      state.launched.push(args);
      if (opts.sandboxed) writeFileSync(log, "[1:1:ERROR:mach/bootstrap.cc:65] bootstrap_check_in: Permission denied (1100)\n");
      if (opts.crash) return null;
      const profile = args.find((a) => a.startsWith("--user-data-dir="))!.slice("--user-data-dir=".length);
      if (!opts.noPort) {
        // what Chrome does for --remote-debugging-port=0: pick a port and record it in the profile
        writeFileSync(join(profile, "DevToolsActivePort"), `${state.port}\n/devtools/browser/abc\n`);
        state.running.add(state.port);
      }
      return ++state.pid;
    },
    alive: (pid) => pid > 4000 && !state.killed.includes(pid),
    kill: (pid) => {
      state.killed.push(pid);
      state.running.delete(state.port);
    },
    sleep: () => {},
  };
  return { deps, state };
}

describe("the project's test browser", () => {
  it("asks Chrome for a free port instead of a fixed one, and records what Chrome chose", () => {
    const { p, home } = project();
    const { deps, state } = fakeChrome(home, { port: 51873 });
    const r = startBrowser(p, {}, deps);
    expect(r.started).toBe(true);
    expect(state.launched[0]).toContain("--remote-debugging-port=0");
    expect(state.launched[0]!.join(" ")).not.toMatch(/9222/);
    expect(r.record).toMatchObject({ port: 51873, url: "http://127.0.0.1:51873", headless: true });
    expect(readBrowser(p)?.url).toBe("http://127.0.0.1:51873");
  });

  it("binds to localhost, is headless by default and shows a window with --headed", () => {
    const a = project();
    const fa = fakeChrome(a.home);
    startBrowser(a.p, {}, fa.deps);
    expect(fa.state.launched[0]).toEqual(expect.arrayContaining(["--remote-debugging-address=127.0.0.1", "--headless=new"]));
    const b = project();
    const fb = fakeChrome(b.home);
    startBrowser(b.p, { headed: true }, fb.deps);
    expect(fb.state.launched[0]).not.toContain("--headless=new");
  });

  it("gives every project its own profile, so two projects never share a browser", () => {
    const a = project();
    const b = project();
    expect(profileDir(a.p, a.home)).not.toBe(profileDir(b.p, a.home));
    expect(profileDir(a.p, a.home)).toBe(profileDir(a.p, a.home));
    expect(profileDir(a.p, a.home)).toContain(".aidw-chrome");
  });

  it("does not start a second browser when one answers, and restarts a dead one", () => {
    const { p, home } = project();
    const { deps, state } = fakeChrome(home);
    startBrowser(p, {}, deps);
    expect(startBrowser(p, {}, deps)).toMatchObject({ started: false, running: true });
    expect(state.launched).toHaveLength(1);
    state.running.clear(); // Chrome died
    expect(browserStatus(p, deps)).toMatchObject({ running: false });
    expect(browserStatus(p, deps).stale).toMatch(/does not answer/);
    state.port = 43999;
    expect(startBrowser(p, {}, deps)).toMatchObject({ started: true, record: { port: 43999 } });
  });

  it("ignores a port a crashed Chrome left in the profile", () => {
    const { p, home } = project();
    const profile = profileDir(p, home);
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, "DevToolsActivePort"), "9222\n/devtools/browser/old\n");
    const { deps } = fakeChrome(home, { port: 40555 });
    expect(startBrowser(p, {}, deps).record?.port).toBe(40555);
  });

  it("hands the endpoint to layer commands as E2E_CDP_URL and E2E_CDP_PORT", () => {
    const { p, home } = project();
    expect(browserEnv(p)).toEqual({});
    startBrowser(p, {}, fakeChrome(home, { port: 45000 }).deps);
    expect(browserEnv(p)).toEqual({ E2E_CDP_URL: "http://127.0.0.1:45000", E2E_CDP_PORT: "45000" });
  });

  it("falls back to the temp directory when the home directory is not writable (the sandbox)", () => {
    const { p } = project();
    const blocker = join(tmp(), "not-a-dir");
    writeFileSync(blocker, "x"); // a file where the profile directory would have to be created
    const tempRoot = tmp();
    const { deps } = fakeChrome(blocker);
    const r = startBrowser(p, {}, { ...deps, tmp: tempRoot });
    expect(r.record?.profile.startsWith(tempRoot)).toBe(true);
  });

  it("reports a Chrome that never opens a port, and a launch the sandbox blocks", () => {
    const a = project();
    expect(() => startBrowser(a.p, {}, fakeChrome(a.home, { noPort: true }).deps)).toThrow(/did not open a debugging port/);
    expect(existsSync(browserFile(a.p))).toBe(false);
    const b = project();
    expect(() => startBrowser(b.p, {}, fakeChrome(b.home, { crash: true }).deps)).toThrow(BrowserError);
    expect(() => startBrowser(b.p, {}, { ...fakeChrome(b.home).deps, chrome: () => null })).toThrow(/no Chrome found/);
  });

  it("says why when the sandbox keeps Chrome from starting", () => {
    const { p, home } = project();
    expect(() => startBrowser(p, { timeoutMs: 500 }, fakeChrome(home, { noPort: true, sandboxed: true }).deps)).toThrow(/sandbox of this session does not let Chrome start/);
  });

  it("stop ends the process and forgets the record", () => {
    const { p, home } = project();
    const { deps, state } = fakeChrome(home);
    startBrowser(p, {}, deps);
    expect(stopBrowser(p, deps)).toBe(true);
    expect(state.killed).toHaveLength(1);
    expect(readBrowser(p)).toBeNull();
    expect(stopBrowser(p, deps)).toBe(false);
  });
});

describe("aidw browser", () => {
  it("fails with a pointer when no test browser exists, and reports status", () => {
    const { root } = project();
    let out = "";
    let err = "";
    const io = { out: (s: string) => (out += s), err: (s: string) => (err += s) };
    expect(run(["browser", "url", "--root", root], {}, root, io)).toBe(1);
    expect(err).toMatch(/run `aidw browser start`/);
    expect(run(["browser", "status", "--root", root], {}, root, io)).toBe(1);
    expect(out).toMatch(/no test browser/);
    expect(run(["browser", "nope", "--root", root], {}, root, io)).toBe(2);
  });

  it("passes the recorded browser to the commands it runs, unless the user already set one", () => {
    const { root, p } = project();
    mkdirSync(p.run, { recursive: true });
    writeFileSync(browserFile(p), JSON.stringify({ port: 46001, url: "http://127.0.0.1:46001", pid: 1, profile: "x", headless: true, started_at: "now" }));
    const saved = { url: process.env.E2E_CDP_URL, port: process.env.E2E_CDP_PORT };
    try {
      delete process.env.E2E_CDP_URL;
      delete process.env.E2E_CDP_PORT;
      run(["status", "--root", root], process.env, root, { out: () => {}, err: () => {} });
      expect(process.env.E2E_CDP_URL).toBe("http://127.0.0.1:46001");
      expect(process.env.E2E_CDP_PORT).toBe("46001");
      process.env.E2E_CDP_URL = "http://127.0.0.1:9333"; // the user's own browser wins
      run(["status", "--root", root], process.env, root, { out: () => {}, err: () => {} });
      expect(process.env.E2E_CDP_URL).toBe("http://127.0.0.1:9333");
    } finally {
      for (const [k, v] of [["E2E_CDP_URL", saved.url], ["E2E_CDP_PORT", saved.port]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
