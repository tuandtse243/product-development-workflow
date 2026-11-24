import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { decide, type HookInput } from "../src/gate.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TOKENS_YAML, tempProject, write } from "./fixtures.js";

// Plan D2 gate rule, read the way the shell reads it: the allowed start must run the plugin's own CLI, not whatever
// the shell turns the words into. The gate sees the literal string; the shell then expands globs and braces and
// splits words only on space and tab. Every form here is checked against a real directory tree.

const ID = "app";
let root: string;

function cli(...argv: string[]) {
  return run([...argv, "--root", root], {}, root, { out: () => {}, err: () => {} });
}

const TASKS = `tasks:
${[1, 2, 3, 4]
  .map(
    (i) => `  - id: T0${i}
    title: Slice ${i}
    role: backend-engineer
    type: feat
    ${i === 1 ? "specs: [booking/reschedule-appointment]\n    scenarios: [booking/reschedule-appointment/reschedule-appointment-works]\n    " : ""}depends_on: ${i === 1 ? "[]" : "[T01]"}
    touches: ["app/s${i}/**"]
    verify: ["pnpm vitest run s${i}"]
    status: pending`,
  )
  .join("\n")}
`;

/** A plugin root, and next to it a directory the session can write (the project, a temp dir). */
function tree() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "aidw-shell-")));
  // installed shape, outside the project: the only plugin whose exact start the gate allows without asking
  const plugin = join(base, "home", ".claude", "plugins", "aidw");
  mkdirSync(join(plugin, "bin"), { recursive: true });
  writeFileSync(join(plugin, "bin", "aidw"), "#!/bin/sh\necho plugin\n");
  chmodSync(join(plugin, "bin", "aidw"), 0o755);
  const proj = join(base, "proj");
  mkdirSync(proj);
  return { base, plugin, proj };
}

/** A script the session planted: it must never be what the allowed command runs. */
function evil(dir: string) {
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "bin", "aidw"), "#!/bin/sh\necho evil\n");
  chmodSync(join(dir, "bin", "aidw"), 0o755);
  mkdirSync(join(dir, "hooks"), { recursive: true });
}

/** What the shell runs for `cmd` (echo stands in for the command word). */
function shellWords(cmd: string, cwd: string): string {
  return execFileSync("/bin/sh", ["-c", `printf '%s\\n' ${cmd}`], { cwd }).toString();
}

function approved() {
  root = tempProject();
  expect(cli("init")).toBe(0);
  expect(cli("change", "new", ID)).toBe(0);
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  write(root, `.aidw/changes/${ID}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `.aidw/changes/${ID}/tasks.yaml`, TASKS);
  write(root, `.aidw/changes/${ID}/quality.yaml`, QUALITY_YAML);
  write(root, `.aidw/changes/${ID}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli("transition", ID, s)).toBe(0);
  expect(cli("approve", ID)).toBe(0);
}

describe("gate: the shell expands what the gate matched (D2)", () => {
  let t: ReturnType<typeof tree>;
  let env: NodeJS.ProcessEnv;
  const decision = (command: string) =>
    decide({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: root } as HookInput, env)?.decision ?? "none";
  const TAIL = `run ${ID} --detach --permission-mode auto`;

  beforeEach(() => {
    approved();
    t = tree();
    env = { AIDW_PLUGIN_ROOT: t.plugin } as NodeJS.ProcessEnv;
  });

  it("allows only the exact command aidw approve prints for an installed plugin", () => {
    expect(decision(`${t.plugin}/bin/aidw ${TAIL}`)).toBe("allow");
    expect(decision(`  ${t.plugin}/bin/aidw ${TAIL}\n`)).toBe("allow"); // trimmed
    for (const c of [`${t.plugin}/bin/aidw ${TAIL} -- --plugin-dir ${t.plugin}`, `aidw ${TAIL}`, `${t.plugin}/bin/aidw ${TAIL} --max-runs 3`, `${t.plugin}/bin/aidw  ${TAIL}`]) {
      expect([c, decision(c)]).toEqual([c, "ask"]);
    }
    expect(decision(`${t.plugin}/bin/aidw ${TAIL}`.replace(`run ${ID}`, "run"))).toBe("deny");
  });

  it("does not allow a glob in the CLI path that the shell expands to a planted aidw", () => {
    evil(join(t.proj, "e"));
    symlinkSync(t.plugin, join(t.proj, "[e]")); // the literal name the gate resolves points at the plugin
    const bin = `${t.proj}/[e]/bin/aidw`;
    expect(shellWords(bin, t.proj).trim()).toBe(`${t.proj}/e/bin/aidw`); // what actually runs
    expect(decision(`${bin} ${TAIL}`)).not.toBe("allow");
  });

  it("does not allow a brace list in the CLI path that the shell expands to a planted aidw", () => {
    evil(join(t.proj, "e"));
    symlinkSync(t.plugin, join(t.proj, "{e,x}"));
    const bin = `${t.proj}/{e,x}/bin/aidw`;
    expect(shellWords(bin, t.proj).split("\n")[0]).toBe(`${t.proj}/e/bin/aidw`);
    expect(decision(`${bin} ${TAIL}`)).not.toBe("allow");
  });

  it("does not allow a glob in --plugin-dir that the shell expands to a planted plugin", () => {
    evil(join(t.proj, "p"));
    symlinkSync(t.plugin, join(t.proj, "[p]"));
    const dir = `${t.proj}/[p]`;
    expect(shellWords(dir, t.proj).trim()).toBe(`${t.proj}/p`);
    expect(decision(`aidw ${TAIL} -- --plugin-dir ${dir}`)).not.toBe("allow");
  });

  it("does not allow whitespace the shell does not split on (no-break space, vertical tab, form feed, em space)", () => {
    // `aidw<NBSP>run` is one word to the shell: a command named "aidw run" looked up on PATH, which the session may
    // have planted in a writable PATH directory.
    for (const sp of [" ", "\v", "\f", " ", "　", "﻿"]) {
      const c = `aidw${sp}${TAIL}`;
      expect(shellWords(`aidw${sp}run`, t.proj).trim()).toBe(`aidw${sp}run`);
      expect([JSON.stringify(c), decision(c)]).not.toEqual([JSON.stringify(c), "allow"]);
    }
  });

  it("does not allow a symlink the session controls as --plugin-dir (it can be swapped after the check)", () => {
    symlinkSync(t.plugin, join(t.proj, "plugin-link"));
    expect(decision(`aidw ${TAIL} -- --plugin-dir ${t.proj}/plugin-link`)).not.toBe("allow");
  });
});
