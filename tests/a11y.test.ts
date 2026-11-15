import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { detectProject } from "../src/detect.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, tempProject, write } from "./fixtures.js";

const ID = "booking-v2";

function setup(opts: { quality?: string; profile?: string } = {}): string {
  const root = tempProject();
  const cli = (...a: string[]) => run([...a, "--root", root], {}, root, { out: () => undefined, err: () => undefined });
  cli("init");
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  cli("change", "new", ID);
  write(root, `.aidw/changes/${ID}/analysis.md`, opts.profile ? ANALYSIS_MD.replace("a11y is left out: the fixture has no axe.", opts.profile) : ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `.aidw/changes/${ID}/tasks.yaml`, TASKS_YAML);
  write(root, `.aidw/changes/${ID}/quality.yaml`, opts.quality ?? QUALITY_YAML);
  write(root, `.aidw/changes/${ID}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  return root;
}
const analyze = (root: string) => {
  let out = "";
  const code = run(["analyze", ID, "--root", root], {}, root, { out: (s) => (out += s), err: () => undefined });
  return { code, out };
};
const A11Y = `  - name: a11y\n    run: ['node -e "process.exit(0)"']\n`;

describe("a UI change gets the a11y layer by default", () => {
  it("is refused without an a11y layer or a reason for leaving it out", () => {
    const root = setup({ profile: "code, unit, integration, e2e, review." });
    const r = analyze(root);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/change UI but there is no a11y layer: add it \(axe through Playwright/);
  });

  it("passes with the layer", () => {
    const root = setup({ quality: QUALITY_YAML.replace("layers:\n", `layers:\n${A11Y}`) });
    expect(analyze(root).out).not.toMatch(/no a11y layer/);
  });

  it("passes when the Quality profile says why it is left out", () => {
    expect(analyze(setup()).out).not.toMatch(/no a11y layer/);
  });
});

describe("aidw detect", () => {
  it("reports axe when the project has it, so the plan knows whether to add it", () => {
    const root = tempProject();
    write(root, "package.json", JSON.stringify({ devDependencies: { "@playwright/test": "1.55.0", "@axe-core/playwright": "4.10.0" } }));
    expect(detectProject(root).stack["a11y tests"]).toMatch(/^axe-core/);
    const bare = tempProject();
    write(bare, "package.json", JSON.stringify({ devDependencies: { "@playwright/test": "1.55.0" } }));
    expect(detectProject(bare).stack["a11y tests"]).toBeUndefined();
  });
});
