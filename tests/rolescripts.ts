import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Helpers for the tests of a Role's own scripts (roles/<id>/scripts/*.mjs): fixture trees in temp dirs, run by path. */

export const roleScript = (role: string, name: string) => join(__dirname, "..", "plugins", "aidw", "roles", role, "scripts", name);

const temps: string[] = [];
export const cleanTemps = () => temps.splice(0).forEach((t) => rmSync(t, { recursive: true, force: true }));

/** A temp project holding the given files (path -> content). */
export function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "aidw-rolescript-"));
  temps.push(root);
  write(root, files);
  return root;
}

export function write(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

export interface ScriptRun { code: number | null; stdout: string; stderr: string; json: any }

/** Runs `node <script> ...args` in `cwd` and parses stdout as JSON when it is JSON. */
export function runScript(script: string, args: string[], cwd?: string, env: Record<string, string> = {}): ScriptRun {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  let json: any = null;
  try { json = JSON.parse(r.stdout); } catch { /* text mode or an error */ }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

/** git in a fixture: init + commit everything as the base. */
export function gitBase(root: string): void {
  const g = (...a: string[]) => {
    const r = spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: root, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  };
  g("init", "-q", "-b", "main");
  g("add", "-A");
  g("commit", "-q", "-m", "base");
}
