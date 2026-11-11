import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { retryingShellRunner } from "../src/run.js";

// A command that fails the first time it runs in a directory and passes afterwards.
const FLIP = `node -e "const f=require('fs'),p='ran';if(f.existsSync(p))process.exit(0);f.writeFileSync(p,'1');process.exit(1)"`;

describe("retryingShellRunner", () => {
  it("reruns a failed command once and marks a pass on the rerun as flaky", () => {
    const dir = mkdtempSync(join(tmpdir(), "aidw-flaky-"));
    const r = retryingShellRunner(FLIP, dir, 10_000);
    expect(r.exit).toBe(0);
    expect(r.flaky).toBe(true);
  });

  it("keeps a real failure as a failure, with the first output", () => {
    const dir = mkdtempSync(join(tmpdir(), "aidw-flaky-"));
    writeFileSync(join(dir, "count"), "");
    const r = retryingShellRunner(`node -e "console.log('boom');process.exit(3)"`, dir, 10_000);
    expect(r.exit).toBe(3);
    expect(r.flaky).toBeUndefined();
    expect(r.tail).toMatch(/boom/);
  });

  it("does not mark a first-try pass", () => {
    const r = retryingShellRunner(`node -e "process.exit(0)"`, tmpdir(), 10_000);
    expect(r).toMatchObject({ exit: 0 });
    expect(r.flaky).toBeUndefined();
  });
});
