import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { doctor } from "../src/doctor.js";
import { installGuard, installProblem, installRunner, installStatus, lastProbe, packageManagerOf, probeCommand, probeInstall, useInstallRunner, type ShellResult, type ShellRun } from "../src/installcheck.js";
import { pathsFor } from "../src/project.js";
import { ANALYSIS_MD, TOKENS_YAML, tempProject, write, planReviewed } from "./fixtures.js";

const ok: ShellResult = { ok: true, out: "added 1 package", timedOut: false };
const bad = (out: string, timedOut = false): ShellResult => ({ ok: false, out, timedOut });
/** A shell that answers from a script, one answer per call, and remembers what it was asked. */
function scripted(...answers: ShellResult[]): ShellRun & { calls: { command: string; cwd: string }[] } {
  const calls: { command: string; cwd: string }[] = [];
  const fn: ShellRun = (command, cwd) => {
    calls.push({ command, cwd });
    return answers[Math.min(calls.length - 1, answers.length - 1)]!;
  };
  return Object.assign(fn, { calls });
}
const fast = { pauseMs: 0 };

describe("the install probe", () => {
  it("installs one tiny package in a scratch folder and leaves nothing behind", () => {
    const p = pathsFor(tempProject());
    const shell = scripted(ok);
    const r = probeInstall(p, "npm", shell, fast);
    expect(r).toMatchObject({ status: "ok", pm: "npm", attempts: 1, tries: 3 });
    expect(shell.calls).toHaveLength(1);
    expect(shell.calls[0]!.command).toMatch(/^npm install --ignore-scripts .*is-number@7\.0\.0$/);
    expect(shell.calls[0]!.cwd).toContain("install-probe"); // never the project folder
    expect(existsSync(join(p.run, "install-probe"))).toBe(false);
    expect(lastProbe(p)).toMatchObject({ status: "ok", pm: "npm" });
  });

  it("uses the project's package manager", () => {
    expect(probeCommand("pnpm")).toMatch(/^pnpm add --ignore-scripts is-number/);
    expect(probeCommand("yarn")).toMatch(/^yarn add --ignore-scripts is-number/);
    expect(probeCommand("bun")).toMatch(/^bun add --ignore-scripts is-number/);
    expect(packageManagerOf(["CI=1 pnpm build", "npx vitest"])).toBe("pnpm");
    expect(packageManagerOf(["npx playwright test"])).toBe("npm");
    expect(packageManagerOf(["python -m pytest", "! git grep x"])).toBeNull();
  });

  it("calls a pass on a later try FLAKY: a scanner that times out now and then is a warning, not a failure", () => {
    const p = pathsFor(tempProject());
    const shell = scripted(bad("Timeout exceeded while scanning npm install command"), ok);
    const r = probeInstall(p, "npm", shell, fast);
    expect(r).toMatchObject({ status: "flaky", attempts: 2, tries: 3 });
    expect(r.detail).toMatch(/try 2 of 3/);
  });

  it("fails when every try fails, and says why in one line, without the shell's job-control noise", () => {
    const p = pathsFor(tempProject());
    const shell = scripted(bad("zsh: can't set tty process group\nFailed to check for malicious packages: Timeout exceeded while scanning npm install command"));
    const r = probeInstall(p, "npm", shell, fast);
    expect(r).toMatchObject({ status: "fail", attempts: 3, tries: 3 });
    expect(r.detail).toBe("Failed to check for malicious packages: Timeout exceeded while scanning npm install command");
    expect(shell.calls).toHaveLength(3);
  });

  it("reports a command that never answered as a timeout", () => {
    const p = pathsFor(tempProject());
    const r = probeInstall(p, "pnpm", scripted(bad("", true)), { ...fast, tries: 1, timeoutMs: 60_000 });
    expect(r).toMatchObject({ status: "fail", detail: "no answer within 60 s" });
  });

  it("reuses a recent pass, but runs again for `fresh` and after a failure", () => {
    const p = pathsFor(tempProject());
    const shell = scripted(ok);
    installStatus(p, "npm", shell, fast);
    installStatus(p, "npm", shell, fast);
    expect(shell.calls).toHaveLength(1); // the second call was served from the record
    installStatus(p, "npm", shell, { ...fast, fresh: true });
    expect(shell.calls).toHaveLength(2);
    installStatus(p, "pnpm", shell, fast); // another package manager is another question
    expect(shell.calls).toHaveLength(3);
    const old = Date.now() + 31 * 60_000;
    installStatus(p, "pnpm", shell, { ...fast, now: old });
    expect(shell.calls).toHaveLength(4);

    const failing = scripted(bad("nope"));
    const q = pathsFor(tempProject());
    installStatus(q, "npm", failing, fast);
    installStatus(q, "npm", failing, fast); // a failure is never served from the record: the user may have fixed it
    expect(failing.calls).toHaveLength(6);
  });

  it("tells the user what to do, not just that it failed", () => {
    const text = installProblem({ status: "fail", pm: "npm", attempts: 3, tries: 3, detail: "scan timed out", at: "" }, "2026-11-15-notes");
    expect(text).toMatch(/scan timed out/);
    expect(text).toMatch(/do not start the build/);
    expect(text).toMatch(/aidw doctor 2026-11-15-notes --fresh/);
    expect(text).toMatch(/excludedCommands/);
    expect(text).toMatch(/rtk npm install \*/); // a command rewriter changes what has to be allowed
    expect(text).toMatch(/aidw run 2026-11-15-notes --detach/); // the runner works outside the sandbox
    expect(text).toMatch(/AIDW_SKIP_INSTALL_CHECK=1/);
  });
});

describe("aidw doctor and the install check", () => {
  const withPm = (): string => {
    const root = tempProject();
    run(["init", "--root", root], {}, root, { out: () => {}, err: () => {} });
    run(["change", "new", "2026-11-15-x", "--workflow", "bugfix", "--root", root], {}, root, { out: () => {}, err: () => {} });
    write(root, ".aidw/changes/2026-11-15-x/quality.yaml", "layers:\n  - name: code\n    run: [\"npm run build\"]\ndeploy:\n  target: none\n");
    return root;
  };
  const probe = () => ({ ok: true, out: "ok" });

  it("adds a `package install` check that fails with the way out when packages cannot be installed", () => {
    const root = withPm();
    const checks = doctor(pathsFor(root), "2026-11-15-x", {}, probe, { run: scripted(bad("Timeout exceeded while scanning npm install command")) });
    const c = checks.find((x) => x.name === "package install")!;
    expect(c.status).toBe("fail");
    expect(c.detail).toMatch(/Timeout exceeded/);
    expect(c.detail).toMatch(/aidw doctor 2026-11-15-x --fresh/);
  });

  it("passes, or warns when it only passes on a later try", () => {
    const root = withPm();
    const p = pathsFor(root);
    expect(doctor(p, "2026-11-15-x", {}, probe, { run: scripted(ok), fresh: true }).find((x) => x.name === "package install")?.status).toBe("ok");
    expect(doctor(p, "2026-11-15-x", {}, probe, { run: scripted(bad("slow"), ok), fresh: true }).find((x) => x.name === "package install")?.status).toBe("warn");
  });

  it("does not install anything unless asked to, and not when the packages are already there", () => {
    const root = withPm();
    expect(doctor(pathsFor(root), "2026-11-15-x", {}, probe).some((x) => x.name === "package install")).toBe(false);
    mkdirSync(join(root, "node_modules"));
    expect(doctor(pathsFor(root), "2026-11-15-x", {}, probe, { run: scripted(bad("x")) }).some((x) => x.name === "package install")).toBe(false);
  });
});

describe("aidw transition executing", () => {
  const ID = "2026-11-15-fix";
  const original = installRunner();
  afterEach(() => {
    useInstallRunner(original);
    delete process.env.AIDW_SKIP_INSTALL_CHECK;
  });
  function cli(root: string, ...argv: string[]) {
    let out = "";
    const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (out += s) });
    return { code, out };
  }
  /** An approved bugfix whose layers use npm, in a folder with no node_modules. */
  function approved(): string {
    const root = tempProject();
    cli(root, "init");
    expect(cli(root, "change", "new", ID, "--workflow", "bugfix").code).toBe(0);
    const c = `.aidw/changes/${ID}`;
    write(root, `${c}/analysis.md`, ANALYSIS_MD);
    write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
    write(root, `${c}/quality.yaml`, `layers:\n  - name: code\n    run: ["npm run build"]\n  - name: unit\n    run: ["npx vitest run"]\ndeploy:\n  target: none\n`);
    write(root, `${c}/tasks.yaml`, `tasks:\n  - id: T01\n    title: Fix add\n    role: fullstack\n    type: fix\n    scope: math\n    touches: ["lib/**", "tests/**"]\n    verify: ["node tests/a.test.js"]\n`);
    planReviewed(root, ID);
    for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).code, s).toBe(0);
    expect(cli(root, "approve", ID, "--auto").code).toBe(0);
    return root;
  }

  it("refuses to start the build while packages cannot be installed, with the way out", () => {
    const root = approved();
    useInstallRunner(scripted(bad("Failed to check for malicious packages: Timeout exceeded while scanning npm install command")));
    const r = cli(root, "transition", ID, "executing");
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/"executing" refused: packages cannot be installed from here/);
    expect(r.out).toMatch(/Timeout exceeded while scanning/);
    expect(r.out).toMatch(/aidw doctor .* --fresh/);
    expect(JSON.parse(readFileSync(join(root, ".aidw/run/install-probe.json"), "utf8"))).toMatchObject({ status: "fail", pm: "npm" });
  });

  it("starts once the install works, and a later resume is not slowed by another probe", () => {
    const root = approved();
    const shell = scripted(bad("slow"), bad("slow"), bad("slow"), ok);
    useInstallRunner(shell);
    expect(cli(root, "transition", ID, "executing").code).not.toBe(0); // 3 tries, all failed
    expect(cli(root, "transition", ID, "executing").code).toBe(0); // the user fixed it: the next probe passes
    const calls = shell.calls.length;
    cli(root, "transition", ID, "escalated", "--reason", "x");
    expect(cli(root, "transition", ID, "executing").code).toBe(0);
    expect(shell.calls).toHaveLength(calls); // the recent pass was reused
  });

  it("can be skipped on purpose, and is not asked of a project that has its packages", () => {
    const root = approved();
    useInstallRunner(scripted(bad("nope")));
    process.env.AIDW_SKIP_INSTALL_CHECK = "1";
    expect(cli(root, "transition", ID, "executing").code).toBe(0);
    expect(installGuard(pathsFor(root), ID, ["npm run build"], { AIDW_SKIP_INSTALL_CHECK: "1" }, scripted(bad("x")))).toBeNull();
    mkdirSync(join(root, "node_modules"));
    expect(installGuard(pathsFor(root), ID, ["npm run build"], {}, scripted(bad("x")))).toBeNull();
    writeFileSync(join(root, "x"), "");
  });

  it("does not apply to a project whose layers do not install from npm", () => {
    const root = tempProject();
    expect(installGuard(pathsFor(root), ID, ["python -m pytest"], {}, scripted(bad("x")))).toBeNull();
  });
});
