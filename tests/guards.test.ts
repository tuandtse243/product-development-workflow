import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { isLockedConfig } from "../src/configlock.js";
import { usePackageLookup, type Lookup } from "../src/depsafety.js";
import { decide } from "../src/gate.js";
import { scanLine } from "../src/secrets.js";
import { ANALYSIS_MD, QUALITY_YAML, tempProject, write, planReviewed } from "./fixtures.js";

const ID = "2026-11-17-guards";
const OLD: Lookup = () => ({ status: "found", publishedAt: "2020-01-01T00:00:00Z", advisories: [] });
afterEach(() => usePackageLookup(OLD));

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}
const git = (root: string, ...a: string[]) => execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", ...a], { cwd: root, encoding: "utf8" });
// Built at run time so this file holds no string that looks like a key.
const AWS_KEY = `AKIA${"Q".repeat(16)}`;

/** An approved change on a project with lint config and one dependency; T01 (of the given type) is running. */
function running(type = "feat"): string {
  const root = tempProject();
  cli(root, "init");
  expect(cli(root, "change", "new", ID, "--workflow", "bugfix").code).toBe(0);
  const c = `.aidw/changes/${ID}`;
  write(root, `${c}/analysis.md`, ANALYSIS_MD);
  write(root, `${c}/quality.yaml`, QUALITY_YAML);
  write(root, `${c}/tasks.yaml`, `tasks:\n  - id: T01\n    title: Add sum\n    role: fullstack\n    type: ${type}\n    scope: math\n    touches: ["**"]\n    verify: ["node -e 0"]\n    status: pending\n`);
  write(root, "eslint.config.js", "export default [{ rules: { eqeqeq: 'error' } }];\n");
  write(root, "vitest.config.ts", "export default { test: { coverage: { thresholds: { lines: 80 } } } };\n");
  write(root, "package.json", `${JSON.stringify({ name: "app", private: true, dependencies: { leftpad: "1.0.0" } }, null, 2)}\n`);
  write(root, ".gitignore", "node_modules/\n");
  planReviewed(root, ID);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).code, s).toBe(0);
  expect(cli(root, "approve", ID, "--auto").code).toBe(0);
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  expect(cli(root, "transition", ID, "executing").code).toBe(0);
  expect(cli(root, "task", "start", "T01").code).toBe(0);
  return root;
}
const evidence = (root: string) => JSON.parse(readFileSync(join(root, ".aidw/changes", ID, "evidence/T01.json"), "utf8")).checkpoints.at(-1);
const brief = (root: string, ...a: string[]) => readFileSync(cli(root, "brief", "T01", ...a).out.trim(), "utf8");

describe("a task may not change the configuration of its checks", () => {
  it("fails when a feature task edits an existing lint config", () => {
    const root = running();
    write(root, "eslint.config.js", "export default [{ rules: { eqeqeq: 'off' } }];\n");
    const r = cli(root, "checkpoint", "T01");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/check configuration changed by a task that is not a tooling task: eslint\.config\.js/);
    expect(brief(root)).toMatch(/You changed the configuration of the checks: `eslint\.config\.js`/);
  });

  it("lets a tooling task change it and tells the reviewer", () => {
    const root = running("chore");
    write(root, "eslint.config.js", "export default [{ rules: { eqeqeq: 'warn' } }];\n");
    expect(cli(root, "checkpoint", "T01").code).toBe(0);
    expect(evidence(root).config).toEqual({ locked: [], watched: ["eslint.config.js"] });
    expect(brief(root, "--for", "review")).toMatch(/Configuration of the checks changed by this task: `eslint\.config\.js`/);
  });

  it("lets any task create a config file, and only reports a changed test-runner config", () => {
    const root = running();
    write(root, "tsconfig.json", '{ "compilerOptions": { "strict": true } }\n');
    write(root, ".github/workflows/ci.yml", "on: push\n");
    write(root, "vitest.config.ts", "export default { test: { coverage: { thresholds: { lines: 10 } } } };\n");
    const r = cli(root, "checkpoint", "T01");
    expect(r.code, r.out).toBe(0);
    expect(evidence(root).config).toEqual({ locked: [], watched: ["vitest.config.ts"] });
  });

  it("knows the locked files by name and by folder", () => {
    for (const f of ["tsconfig.app.json", "apps/web/.eslintrc.cjs", ".github/workflows/ci.yml", ".husky/pre-commit", "biome.json", "ruff.toml"]) expect(isLockedConfig(f), f).toBe(true);
    for (const f of ["src/config.ts", "package.json", "pyproject.toml", "docs/tsconfig.md"]) expect(isLockedConfig(f), f).toBe(false);
  });

  it("denies a commit that skips the git hooks", () => {
    const root = running();
    const bash = (command: string) => decide({ tool_name: "Bash", tool_input: { command }, cwd: root }, {})?.decision;
    expect(bash('git commit --no-verify -m "x"')).toBe("deny");
    expect(bash('git commit -nm "x"')).toBe("deny");
    expect(bash('HUSKY=0 git commit -m "x"')).toBe("deny");
    expect(bash('git commit -m "x"')).not.toBe("deny");
  });
});

describe("no credential enters the repository", () => {
  it("fails the checkpoint without recording the value", () => {
    const root = running();
    write(root, "lib/aws.js", `exports.key = "${AWS_KEY}";\n`);
    const r = cli(root, "checkpoint", "T01");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/credential in the code: AWS access key at lib\/aws\.js:1/);
    expect(JSON.stringify(evidence(root))).not.toContain(AWS_KEY);
    expect(brief(root)).toMatch(/Read it from an environment variable/);
  });

  it("skips a line marked as an example and placeholders in connection strings", () => {
    expect(scanLine(`const example = "${AWS_KEY}"; // gitleaks:allow`)).toBeNull();
    expect(scanLine("DATABASE_URL=postgres://user:password@localhost:5432/app")).toBeNull();
    expect(scanLine("DATABASE_URL=postgres://app:${DB_PASSWORD}@db.internal/app")).toBeNull();
    expect(scanLine("DATABASE_URL=postgres://app:Xk29fjq0Lm3z@db.prod.example.net/app")).toBe("database URL with a password");
    expect(scanLine("-----BEGIN OPENSSH PRIVATE KEY-----")).toBe("private key");
  });

  it("refuses the task commit when a key appears after the checkpoint", () => {
    const root = running();
    write(root, "lib/sum.js", "exports.sum = (a, b) => a + b;\n");
    expect(cli(root, "checkpoint", "T01").code).toBe(0);
    write(root, "lib/aws.js", `exports.key = "${AWS_KEY}";\n`);
    write(root, ".aidw/run/review-T01.md", "VERDICT: pass\n");
    const r = cli(root, "verdict", "T01");
    expect(r.out + r.err).toMatch(/refusing to commit: credential in the code: AWS access key at lib\/aws\.js:1/);
    expect(git(root, "log", "--format=%s")).not.toMatch(/add sum/);
  });
});

describe("a package a task adds is looked up", () => {
  const add = (root: string, deps: Record<string, string>) =>
    write(root, "package.json", `${JSON.stringify({ name: "app", private: true, dependencies: { leftpad: "1.0.0", ...deps } }, null, 2)}\n`);

  it("passes an established package and never looks up what was already there", () => {
    const root = running();
    const asked: string[] = [];
    usePackageLookup((_e, name, version) => (asked.push(`${name}@${version}`), OLD("npm", name, version)));
    add(root, { zod: "3.23.8" });
    expect(cli(root, "checkpoint", "T01").code).toBe(0);
    expect(asked).toEqual(["zod@3.23.8"]);
    expect(brief(root, "--for", "review")).toMatch(/Packages added \(each exists, is old enough and has no known advisory\): `zod@3\.23\.8`/);
  });

  it("uses the installed version when the manifest gives a range", () => {
    const root = running();
    const asked: string[] = [];
    usePackageLookup((_e, name, version) => (asked.push(`${name}@${version}`), OLD("npm", name, version)));
    add(root, { zod: "^3.0.0" });
    write(root, "node_modules/zod/package.json", '{ "name": "zod", "version": "3.24.1" }\n');
    expect(cli(root, "checkpoint", "T01").code).toBe(0);
    expect(asked).toEqual(["zod@3.24.1"]);
  });

  it("fails on a package that does not exist, is too new, or has an advisory", () => {
    const root = running();
    const now = Date.now();
    usePackageLookup((_e, name) =>
      name === "ghost" ? { status: "not-found" }
      : name === "fresh" ? { status: "found", publishedAt: new Date(now - 3_600_000).toISOString(), advisories: [] }
      : { status: "found", publishedAt: "2020-01-01T00:00:00Z", advisories: ["GHSA-aaaa-bbbb-cccc"] });
    add(root, { ghost: "1.0.0", fresh: "2.0.0", holey: "3.0.0" });
    const r = cli(root, "checkpoint", "T01");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/unsafe package ghost@1\.0\.0: this version is not known/);
    expect(r.out).toMatch(/unsafe package fresh@2\.0\.0: published 0\.0 days ago; the minimum is 3/);
    expect(r.out).toMatch(/unsafe package holey@3\.0\.0: known advisories: GHSA-aaaa-bbbb-cccc/);
    expect(brief(root)).toMatch(/Use an older released version without advisories/);
  });

  it("does not fail when the lookup cannot run, and tells the reviewer", () => {
    const root = running();
    usePackageLookup(() => ({ status: "error", error: "could not resolve host" }));
    add(root, { zod: "3.23.8" });
    expect(cli(root, "checkpoint", "T01").code).toBe(0);
    expect(brief(root, "--for", "review")).toMatch(/Packages aidw could NOT check: zod@3\.23\.8: could not resolve host/);
  });

  it("reads Python requirements and the direct packages of a uv lock", () => {
    const root = running();
    const asked: string[] = [];
    usePackageLookup((e, name, version) => (asked.push(`${e}:${name}@${version}`), OLD(e, name, version)));
    write(root, "requirements.txt", "# web\nfastapi==0.115.0\nuvicorn[standard]>=0.30\n");
    write(root, "api/pyproject.toml", '[project]\nname = "api"\ndependencies = ["httpx>=0.27"]\n');
    write(root, "api/uv.lock", '[[package]]\nname = "httpx"\nversion = "0.27.2"\n\n[[package]]\nname = "idna"\nversion = "3.10"\n');
    expect(cli(root, "checkpoint", "T01").code).toBe(0);
    expect(asked.sort()).toEqual(["pypi:fastapi@0.115.0", "pypi:httpx@0.27.2"]);
    expect(evidence(root).packages.unproven[0]).toMatch(/^uvicorn: no exact version/);
  });
});
