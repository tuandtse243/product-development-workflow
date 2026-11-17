import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { parseLcov } from "../src/diffcover.js";
import { tempProject, write } from "./fixtures.js";

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}
const git = (root: string, ...a: string[]) => execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", ...a], { cwd: root, encoding: "utf8" });

/** lib/old.js is untested old code; the change adds three lines to it and a new file. */
function project(): string {
  const root = tempProject();
  cli(root, "init");
  write(root, "lib/old.js", "exports.a = 1;\nexports.b = 2;\n");
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  git(root, "checkout", "-q", "-b", "work");
  write(root, "lib/old.js", "exports.a = 1;\nexports.b = 2;\nexports.c = 3;\nexports.d = 4;\nexports.e = 5;\n");
  write(root, "lib/new.js", "exports.x = 1;\nexports.y = 2;\n");
  return root;
}
const lcov = (oldHits: [number, number, number]) =>
  ["SF:lib/old.js", "DA:1,0", "DA:2,0", `DA:3,${oldHits[0]}`, `DA:4,${oldHits[1]}`, `DA:5,${oldHits[2]}`, "end_of_record", "SF:lib/new.js", "DA:1,4", "DA:2,4", "end_of_record", ""].join("\n");

describe("aidw diff-coverage", () => {
  it("counts only added lines, so old untested code is not held against the change", () => {
    const root = project();
    write(root, "coverage/lcov.info", lcov([1, 1, 1]));
    const r = cli(root, "diff-coverage", "coverage/lcov.info");
    expect(r.code, r.out + r.err).toBe(0);
    expect(r.out).toMatch(/coverage of added lines: 100% \(5 of 5\), minimum 80%/);
  });

  it("fails below the minimum and names the uncovered lines", () => {
    const root = project();
    write(root, "coverage/lcov.info", lcov([1, 0, 0]));
    const r = cli(root, "diff-coverage", "coverage/lcov.info");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/coverage of added lines: 60% \(3 of 5\), minimum 80%/);
    expect(r.out).toMatch(/lib\/old\.js: lines 4-5 are not covered/);
    expect(cli(root, "diff-coverage", "coverage/lcov.info", "--min", "50").code).toBe(0);
  });

  it("passes when the change added no executable line, and says when the report is missing", () => {
    const root = project();
    write(root, "coverage/lcov.info", "SF:lib/other.js\nDA:1,0\nend_of_record\n");
    expect(cli(root, "diff-coverage", "coverage/lcov.info").out).toMatch(/100% \(0 of 0\)/);
    const r = cli(root, "diff-coverage", "coverage/none.info");
    expect(r.code).not.toBe(0);
    expect(r.out + r.err).toMatch(/no coverage report at coverage\/none\.info/);
  });

  it("reads an LCOV report", () => {
    const m = parseLcov("TN:\nSF:a.ts\nDA:1,2\nDA:2,0\nLF:2\nend_of_record\n");
    expect([...(m.get("a.ts") ?? [])]).toEqual([[1, 2], [2, 0]]);
  });
});
