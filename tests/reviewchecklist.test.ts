import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { write } from "./fixtures.js";
import { executingProject } from "./run.test.js";

describe("the review brief", () => {
  it("asks for independent tests, and for accessibility on a UI task", () => {
    const root = executingProject();
    write(root, "tests/booking.test.ts", `import { test } from "vitest";\ntest("booking/reschedule-appointment/reschedule-appointment-works: x", () => {});\n`);
    let out = "";
    const cli = (...a: string[]) => run([...a, "--root", root], {}, root, { out: (s) => (out += s), err: () => undefined });
    cli("task", "start", "T01");
    out = "";
    cli("brief", "T01", "--for", "review");
    const text = readFileSync(out.trim(), "utf8");
    expect(text).toMatch(/7\. Tests are independent: .*passes alone and in any order/);
    expect(text).toMatch(/8\. Accessibility \(no a11y layer may cover this change\)/);
  });
});
