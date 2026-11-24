/**
 * D13: the CLI computes which analysis stages, and which review layers, may run at the same time, from the
 * Artifacts each one reads and writes, and offers them in one NEXT.
 */
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { pickGroup, readyStages, type Work } from "../src/stages.js";
import { loadWorkflow, type Stage, type Workflow } from "../src/workflow.js";
import { tempProject, write } from "./fixtures.js";

const plugin = join(__dirname, "..", "plugins", "aidw");

const w = (id: string, reads: string[], writes: string[], extra: Partial<Work> = {}): Work => ({ id, kind: "stage", reads, writes, browser: false, ...extra });
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("pickGroup: what may run at the same time", () => {
  it("offers two stages with no read/write overlap together", () => {
    expect(ids(pickGroup([w("a", ["intake"], ["x"]), w("b", ["intake"], ["y"])], 3))).toEqual(["a", "b"]);
  });

  it("keeps apart a stage that reads another's output, and two stages that write the same artifact", () => {
    expect(ids(pickGroup([w("a", ["intake"], ["x"]), w("b", ["x"], ["y"])], 3))).toEqual(["a"]);
    expect(ids(pickGroup([w("b", ["x"], ["y"]), w("a", ["intake"], ["x"])], 3))).toEqual(["b"]);
    expect(ids(pickGroup([w("a", [], ["x"]), w("b", [], ["x", "y"]), w("c", [], ["z"])], 3))).toEqual(["a", "c"]);
  });

  it("lets at most one piece of browser-driving work in", () => {
    const g = pickGroup([w("a", [], ["x"], { browser: true }), w("b", [], ["y"], { browser: true }), w("c", [], ["z"])], 3);
    expect(ids(g)).toEqual(["a", "c"]);
  });

  it("honours parallel.max", () => {
    const four = [w("a", [], ["a"]), w("b", [], ["b"]), w("c", [], ["c"]), w("d", [], ["d"])];
    expect(ids(pickGroup(four, 2))).toEqual(["a", "b"]);
    expect(ids(pickGroup(four, 1))).toEqual(["a"]);
  });

  it("offers the reviewers first, the analysis stages after them", () => {
    const g = pickGroup([w("design", [], ["d"]), w("security", [], ["s"], { kind: "review" }), w("ui-ux", [], ["u"], { kind: "review", browser: true })], 3);
    expect(ids(g)).toEqual(["security", "ui-ux"]);
    expect(pickGroup([], 3)).toEqual([]);
  });
});

describe("readyStages: stages whose inputs are written", () => {
  const product = loadWorkflow(plugin, "product") as Workflow;
  const ready = (wf: Workflow, done: string[]) => ids(readyStages(wf, new Set(done)));

  it("waits for the stage that writes what a stage reads", () => {
    expect(ready(product, [])).toEqual(["intake"]);
    expect(ready(product, ["intake"])).toEqual(["discovery"]);
  });

  it("offers research and user research together once discovery is recorded; a gate waits for everything before it", () => {
    expect(ready(product, ["intake", "discovery"])).toEqual(["research", "user-research"]);
    expect(ready(product, ["intake", "discovery", "research"])).toEqual(["user-research"]);
    expect(ready(product, ["intake", "discovery", "research", "user-research"])).toEqual(["scope"]);
    // nothing after a gate starts before the gate is passed
    expect(ready(product, ["intake", "discovery", "research", "user-research", "scope"])).toEqual(["requirements"]);
  });

  it("never offers the build or later stages (they have their own loop)", () => {
    const all = product.stages.filter((s) => s.id !== "approval").map((s) => s.id);
    expect(ready(product, all)).toEqual(["approval"]);
    expect(ready(product, [...all, "approval"])).toEqual([]);
  });

  it("runs independent stages of a made-up workflow side by side and respects the writer order", () => {
    const st = (id: string, reads: string[], writes: string[]): Stage => ({ id, title: id, states: ["analyzing"], roles: [], reads, writes });
    const wf = { ...product, stages: [st("a", [], ["x"]), st("b", ["x"], ["y"]), st("c", ["x"], ["z"]), st("d", ["y", "z"], ["w"])] };
    expect(ready(wf, [])).toEqual(["a"]);
    expect(ready(wf, ["a"])).toEqual(["b", "c"]);
    expect(ready(wf, ["a", "b"])).toEqual(["c"]);
    expect(ready(wf, ["a", "b", "c"])).toEqual(["d"]);
    // a later stage that writes what an earlier, unfinished one reads waits for it
    const war = { ...product, stages: [st("a", ["x"], ["y"]), st("b", [], ["x"])] };
    expect(ready(war, [])).toEqual(["a"]);
  });

  it("marks the design stage as browser-driving (it screenshots the mocks)", () => {
    expect(product.stages.find((s) => s.id === "design")?.browser).toBe(true);
    expect(product.stages.find((s) => s.id === "architecture")?.browser).toBeUndefined();
  });
});

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}

describe("aidw stages", () => {
  const ID = "2026-11-24-notes";
  function project(): string {
    const root = tempProject();
    cli(root, "init");
    expect(cli(root, "change", "new", ID, "--title", "Notes", "--workflow", "product").code).toBe(0);
    return root;
  }

  it("counts the stages before the current state as done and prints the next stage", () => {
    const root = project();
    cli(root, "transition", ID, "intake");
    cli(root, "transition", ID, "analyzing");
    const r = cli(root, "stages", ID);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/done +intake/);
    expect(r.out).toMatch(/NEXT: stage discovery \(Discovery interview.*\): roles product-manager, business-analyst, ux-research; when it is done run `aidw stages --done discovery --change 2026-11-24-notes`/);
  });

  it("offers a group in one NEXT, records each stage reported back, and refuses an unknown or not-ready stage", () => {
    const root = project();
    cli(root, "transition", ID, "intake");
    cli(root, "transition", ID, "analyzing");
    expect(cli(root, "stages", ID, "--done", "research").err).toMatch(/stage "research" is not ready: it waits for discovery/);
    expect(cli(root, "stages", ID, "--done", "nope").err).toMatch(/workflow "product" has no analysis stage "nope"/);
    const r = cli(root, "stages", "--done", "discovery", "--change", ID);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/NEXT: run these 2 stages in parallel, one subagent each, all in one message: research \(Research[^)]*\), user-research \(User kinds[^)]*\)\. When each returns, run `aidw stages --done <stage> --change 2026-11-24-notes` for it/);
    const j = cli(root, "stages", ID, "--json").json();
    expect(j.done).toEqual(["intake", "discovery"]);
    expect(j.group.map((s: { id: string }) => s.id)).toEqual(["research", "user-research"]);
    expect(j.max).toBe(3);
    // each one is reported back on its own
    expect(cli(root, "stages", "--done", "user-research", "--change", ID).out).toMatch(/NEXT: stage research /);
    expect(cli(root, "stages", "--done", "research", "--change", ID).out).toMatch(/NEXT: stage scope \(.*\): roles product-manager; gate scope-approval/);
  });

  it("honours parallel.max of quality.yaml once it is written", () => {
    const root = project();
    cli(root, "transition", ID, "intake");
    cli(root, "transition", ID, "analyzing");
    write(root, `.aidw/changes/${ID}/quality.yaml`, "layers:\n  - name: code\n    run: [x]\nparallel:\n  max: 1\n");
    const j = cli(root, "stages", "--done", "discovery", "--change", ID, "--json").json();
    expect(j.max).toBe(1);
    expect(j.group.map((s: { id: string }) => s.id)).toEqual(["research"]);
    expect(j.ready.map((s: { id: string }) => s.id)).toEqual(["research", "user-research"]);
  });
});

describe("the lead's skills explain the parallel group", () => {
  const read = (f: string) => readFileSync(join(plugin, f), "utf8");
  it("start: one subagent per offered stage in one message, each reported back with aidw stages --done", () => {
    const t = read("skills/start/SKILL.md");
    expect(t).toMatch(/`aidw stages <id>`/);
    expect(t).toMatch(/in a single message\*\* \(parallel Agent calls\)/);
    expect(t).toContain("`aidw stages --done <stage> --change <id>`");
    expect(t).toMatch(/Following the steps one by one, in order, is\s+still correct/);
  });
  it("run: every offered reviewer in one message, each verdict recorded with aidw layer-review", () => {
    const t = read("skills/run/SKILL.md");
    expect(t).toMatch(/all in\s+one message\*\* \(parallel Agent calls, one per layer\)/);
    expect(t).toMatch(/Record every verdict of the group first/);
  });
});

describe("aidw stages with a changed workflow (end to end)", () => {
  const ID = "2026-11-24-notes";
  const RESEARCH = "    writes: [decision-research-needed, research-note]\n";
  const USER_RESEARCH = "    writes: [decision-ux-research-needed, user-journeys]\n";

  /** A copy of the plugin whose product workflow is changed by `edit`, and a change under it past discovery. */
  function project(edit: (yaml: string) => string): { root: string; run: (...argv: string[]) => ReturnType<typeof cli> } {
    const root = tempProject();
    const pr = join(root, "plugin");
    cpSync(plugin, pr, { recursive: true, filter: (src) => !src.includes(`${join(plugin, "bin")}`) });
    const f = join(pr, "workflows", "product.yaml");
    const before = readFileSync(f, "utf8");
    const after = edit(before);
    expect(after).not.toBe(before);
    writeFileSync(f, after);
    const go = (...argv: string[]) => {
      let out = "";
      let err = "";
      const code = run([...argv, "--root", root], { AIDW_PLUGIN_ROOT: pr }, root, { out: (s) => (out += s), err: (s) => (err += s) });
      return { code, out, err, json: () => JSON.parse(out) };
    };
    go("init");
    expect(go("change", "new", ID, "--title", "Notes", "--workflow", "product").code).toBe(0);
    go("transition", ID, "intake");
    go("transition", ID, "analyzing");
    expect(go("stages", "--done", "discovery", "--change", ID).code).toBe(0);
    return { root, run: go };
  }

  it("the unchanged copy offers research and user research together", () => {
    const { run: go } = project((y) => y.replace("# screenshots the mocks", "# (copy) screenshots the mocks"));
    expect(go("stages", ID, "--json").json().group.map((s: { id: string }) => s.id)).toEqual(["research", "user-research"]);
  });

  it("does not offer a stage with the one whose output it reads", () => {
    const { run: go } = project((y) => y.replace("    reads: [intake, analysis-discovery-qa]\n" + RESEARCH, "    reads: [intake, analysis-discovery-qa, user-journeys]\n" + RESEARCH));
    const j = go("stages", ID, "--json").json();
    expect(j.group.map((s: { id: string }) => s.id)).toEqual(["research"]);
    expect(j.ready.map((s: { id: string }) => s.id)).toEqual(["research"]);
    expect(go("stages", ID).out).toMatch(/NEXT: stage research \(/);
    expect(go("stages", "--done", "user-research", "--change", ID).err).toMatch(/stage "user-research" is not ready: it waits for research/);
  });

  it("does not offer two stages that write the same artifact together", () => {
    const { run: go } = project((y) => y.replace(USER_RESEARCH, "    writes: [decision-ux-research-needed, user-journeys, research-note]\n"));
    const j = go("stages", ID, "--json").json();
    expect(j.group.map((s: { id: string }) => s.id)).toEqual(["research"]);
    expect(go("stages", ID).out).not.toMatch(/in parallel/);
  });

  it("offers at most one browser-driving stage at a time", () => {
    const { run: go } = project((y) => y.replace(RESEARCH, `${RESEARCH}    browser: true\n`).replace(USER_RESEARCH, `${USER_RESEARCH}    browser: true\n`));
    const j = go("stages", ID, "--json").json();
    expect(j.ready.map((s: { id: string }) => s.id)).toEqual(["research", "user-research"]);
    expect(j.group.map((s: { id: string; browser?: boolean }) => [s.id, s.browser])).toEqual([["research", true]]);
    expect(go("stages", ID).out).toMatch(/now +research\n {2}ready +user-research\nNEXT: stage research /);
    // once it is reported back the other one is offered
    expect(go("stages", "--done", "research", "--change", ID).out).toMatch(/NEXT: stage user-research /);
  });
});
