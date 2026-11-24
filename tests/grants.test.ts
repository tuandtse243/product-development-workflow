import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { Diags } from "../src/diag.js";
import { decide, type HookInput } from "../src/gate.js";
import { agentRunCap, parseGrants, shellWords } from "../src/grants.js";
import { bundledRoot, pluginRoot } from "../src/plugin.js";
import { parseQuality } from "../src/quality.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, tempProject, write } from "./fixtures.js";

const ID = "app";
const GRANTS = `grants:
  push:
    remote: origin
    base: main
  envelope: true
  agent_runs: 10
`;

let root: string;

function cli(...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}

const env = {} as NodeJS.ProcessEnv;
const bash = (command: string, agent_type?: string): string =>
  decide({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: root, ...(agent_type ? { agent_type } : {}) } as HookInput, env)?.decision ?? "none";

function setChange(patch: (data: Record<string, unknown>) => void) {
  const file = join(root, ".aidw/changes", ID, "change.yaml");
  const data = YAML.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  patch(data);
  writeFileSync(file, YAML.stringify(data));
}

const AIDW_BIN = join(bundledRoot() ?? pluginRoot(env), "bin", "aidw");

function approved(quality: string, before?: () => void) {
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  write(root, `.aidw/changes/${ID}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `.aidw/changes/${ID}/tasks.yaml`, TASKS_YAML);
  write(root, `.aidw/changes/${ID}/quality.yaml`, quality);
  write(root, `.aidw/changes/${ID}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli("transition", ID, s).code).toBe(0);
  before?.();
  expect(cli("approve", ID).code).toBe(0);
  expect(cli("transition", ID, "executing").code).toBe(0);
}

beforeEach(() => {
  root = tempProject();
  cli("init");
  cli("change", "new", ID);
});

describe("grants in quality.yaml", () => {
  it("reads push, envelope and the cap", () => {
    const d = new Diags();
    expect(parseGrants(YAML.parse(GRANTS).grants, "q", d)).toEqual({ push: { remote: "origin", base: "main" }, envelope: true, agentRuns: 10 });
    expect(d.errors).toEqual([]);
    expect(parseGrants(undefined, "q", d)).toEqual({ push: null, envelope: false, agentRuns: null });
  });

  it("refuses a grant it cannot hold the run to", () => {
    const bad = (g: unknown) => {
      const d = new Diags();
      parseGrants(g, "q", d);
      return d.errors.map((e) => e.message).join("\n");
    };
    expect(bad({ push: { remote: "origin" } })).toMatch(/push.base/);
    expect(bad({ push: { remote: "-x", base: "main" } })).toMatch(/push.remote/);
    expect(bad({ push: { remote: "origin", base: "a..b" } })).toMatch(/push.base/);
    expect(bad({ envelope: "yes" })).toMatch(/envelope/);
    expect(bad({ agent_runs: 0 })).toMatch(/agent_runs/);
    expect(bad({ production: true })).toMatch(/unknown grant "production"/);
    expect(bad(["push"])).toMatch(/must be a mapping/);
  });

  it("is part of the parsed quality config and invalid grants fail it", () => {
    expect(parseQuality(QUALITY_YAML + GRANTS, "q").config?.grants.push).toEqual({ remote: "origin", base: "main" });
    expect(parseQuality(QUALITY_YAML, "q").config?.grants).toEqual({ push: null, envelope: false, agentRuns: null });
    expect(parseQuality(QUALITY_YAML + "grants:\n  agent_runs: -1\n", "q").config).toBeNull();
  });

  it("caps Agent runs at 3 times the planned tasks unless the user set a number", () => {
    expect(agentRunCap({ push: null, envelope: false, agentRuns: null }, 4)).toBe(12);
    expect(agentRunCap({ push: null, envelope: false, agentRuns: 7 }, 4)).toBe(7);
    expect(agentRunCap({ push: null, envelope: false, agentRuns: null }, 0)).toBe(3);
  });

  it("splits a command into words and refuses anything the shell would expand or chain", () => {
    expect(shellWords(`gh pr create --title "feat: a b" --draft`)).toEqual(["gh", "pr", "create", "--title", "feat: a b", "--draft"]);
    expect(shellWords(`git push origin 'x'`)).toEqual(["git", "push", "origin", "x"]);
    for (const c of ["a && b", "a; b", "a | b", "a > f", "a $(b)", 'a "$(b)"', "a `b`", "a\nb", 'a "unclosed', "a ~/x", "a *", "a \\x", "a $HOME"]) {
      expect([c, shellWords(c)]).toEqual([c, null]);
    }
  });
});

describe("the grants are approved with the package", () => {
  it("changes the approval hash and freezes the grant after approval", () => {
    approved(QUALITY_YAML + GRANTS);
    expect(cli("approval", "check", ID).code).toBe(0);
    const q = join(root, ".aidw/changes", ID, "quality.yaml");
    expect(decide({ tool_name: "Write", tool_input: { file_path: q }, cwd: root }, env)?.decision).toBe("deny");
    writeFileSync(q, QUALITY_YAML + GRANTS.replace("base: main", "base: develop"));
    expect(cli("approval", "check", ID).code).toBe(1);
  });
});

describe("gate with the push grant", () => {
  beforeEach(() => approved(QUALITY_YAML + GRANTS));

  it("lets the Change Branch be pushed to the granted remote without asking", () => {
    for (const c of ["git push -u origin aidw/app", "git push origin aidw/app", "git push --set-upstream origin aidw/app", "git push origin aidw/app:refs/heads/aidw/app"]) {
      expect([c, bash(c)]).toEqual([c, "allow"]);
    }
  });

  it("lets the one pull request against the granted base be opened, draft included", () => {
    for (const c of [
      'gh pr create --base main --head aidw/app --title "feat(booking): reschedule" --body-file .aidw/run/pr-app.md',
      "gh pr create -B main -H aidw/app --fill --draft",
      "aidw pr app --create",
      "aidw pr app --create --draft --base main",
      `${AIDW_BIN} pr --change app --create --base=main`,
    ]) {
      expect([c, bash(c)]).toEqual([c, "allow"]);
    }
  });

  it("still asks for any other branch, remote, base or form", () => {
    for (const c of [
      "git push origin HEAD:aidw/app", // HEAD may be a Task Worktree's
      "git push origin main",
      "git push upstream aidw/app",
      "git push origin",
      "git push",
      "git push --force origin aidw/app",
      "git push origin +aidw/app",
      "git push origin aidw/app --no-verify",
      "git push origin HEAD:main",
      "git push origin aidw/app && git push origin main",
      "git -C ../other push origin aidw/app",
      `git -C "../my other" push origin aidw/app`,
      "git -c core.sshCommand=x push origin aidw/app",
      "gh pr create --base develop --head aidw/app",
      "gh pr create --base main",
      "gh pr create --base main --head aidw/app --repo someone/else",
      'gh pr create --base main --head aidw/app --title "$(cat ~/.netrc)"',
      "gh pr merge 1",
      "aidw pr app --create --base develop",
      "aidw pr other --create",
      "aidw pr --create",
    ]) {
      expect([c, bash(c)]).toEqual([c, "ask"]);
    }
  });

  it("denies pushing a Task Worktree branch, granted or not", () => {
    for (const c of ["git push origin aidw/app.T01", "git push -u origin aidw/app.T12:aidw/app", "git push origin aidw/app aidw/app.T01", "gh pr create --base main --head aidw/app.T01", "gh pr create --base main --head=aidw/app.T01"]) {
      expect([c, bash(c)]).toEqual([c, "deny"]);
    }
    expect(bash("git push origin aidw/app.T01", "aidw:fullstack")).toBe("deny");
  });

  it("still asks for every other tier 3 action and denies tier x", () => {
    for (const c of ["vercel --prod", "npm publish", "terraform apply", "stripe charges create --live", "gh repo delete x", "psql -c 'drop database app'", "aidw first-deploy"]) {
      expect([c, bash(c)]).toEqual([c, "ask"]);
    }
    expect(bash("git push origin aidw/app ~/.ssh/id_rsa")).toBe("deny");
    expect(bash("cat ~/.aws/credentials")).toBe("deny");
    expect(bash("security dump-keychain")).toBe("deny");
  });

  it("is the Orchestrator's: a subagent's push still asks", () => {
    expect(bash("git push -u origin aidw/app", "aidw:fullstack")).toBe("ask");
    expect(bash("gh pr create --base main --head aidw/app", "aidw:code-reviewer")).toBe("ask");
    expect(bash("git push -u origin aidw/app", "general-purpose")).toBe("ask");
    expect(bash("git push -u origin aidw/app", "Explore")).toBe("ask");
  });

  it("does not follow a branch edited into the approval record", () => {
    setChange((d) => ((d.approval as { push: { branch: string } }).push.branch = "production"));
    expect(bash("git push origin production")).toBe("ask");
    expect(bash("git push origin aidw/app")).toBe("ask"); // the approval drifted
  });

  it("holds after delivery but not while the run is stopped or the package drifted", () => {
    setChange((d) => (d.state = "delivered"));
    expect(bash("aidw pr app --create")).toBe("allow");
    setChange((d) => (d.state = "paused"));
    expect(bash("git push -u origin aidw/app")).toBe("ask");
    setChange((d) => (d.state = "executing"));
    expect(bash("git push -u origin aidw/app")).toBe("allow");
    write(root, `.aidw/changes/${ID}/analysis.md`, ANALYSIS_MD + "\nchanged\n");
    expect(bash("git push -u origin aidw/app")).toBe("ask");
  });
});

describe("gate with the push grant: bypasses it must not grant", () => {
  beforeEach(() => approved(QUALITY_YAML + GRANTS));

  it("does not let the granted pull request post a local file as its body", () => {
    // the body of a pull request leaves the machine: a granted `gh pr create` must not carry .env or any file out
    for (const c of ["gh pr create --base main --head aidw/app --body-file .env", "gh pr create --base main --head aidw/app -F /etc/passwd"]) {
      expect([c, bash(c)]).toEqual([c, "ask"]);
    }
  });

  it("does not grant a program that is only named aidw", () => {
    // an executable the session wrote (./aidw, /tmp/x/aidw) can do anything; only the aidw CLI may carry the grant
    for (const c of ["./aidw pr app --create", "/tmp/x/aidw pr app --create"]) {
      expect([c, bash(c)]).toEqual([c, "ask"]);
    }
  });

  it("does not push a Task Worktree's HEAD as the Change Branch", () => {
    const wt = join(root, ".aidw/run/worktrees", ID, "T01");
    mkdirSync(wt, { recursive: true });
    const c = "git push origin HEAD:aidw/app";
    expect(decide({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: c }, cwd: wt } as HookInput, env)?.decision).toBe("ask");
  });

  it("does not follow a branch the session rewrote in change.yaml after approval", () => {
    const file = join(root, ".aidw/changes", ID, "change.yaml");
    // change.yaml is not frozen: the gate lets the Orchestrator write it after approval
    expect(decide({ tool_name: "Write", tool_input: { file_path: file }, cwd: root }, env)?.decision).toBe("allow");
    setChange((d) => (d.run = { branch: "production" }));
    expect(bash("git push origin production")).toBe("ask");
  });
});

describe("the Change Branch is fixed at approval", () => {
  it("records the branch, remote and base in the approval and follows the branch recorded before it", () => {
    approved(QUALITY_YAML + GRANTS, () => setChange((d) => (d.run = { branch: "feature/booking", base_branch: null })));
    const a = (YAML.parse(readFileSync(join(root, ".aidw/changes", ID, "change.yaml"), "utf8")) as { approval: { push: unknown } }).approval;
    expect(a.push).toEqual({ branch: "feature/booking", remote: "origin", url: null, base: "main" });
    expect(bash("git push -u origin feature/booking")).toBe("allow");
    expect(bash("git push -u origin aidw/app")).toBe("ask");
  });

  it("refuses a branch that is not a plain Change Branch", () => {
    for (const branch of ["main", "develop", "refs/heads/x", "aidw/app.T01", "a..b"]) {
      root = tempProject();
      cli("init");
      cli("change", "new", ID);
      approved(QUALITY_YAML + GRANTS.replace("base: main", "base: release"), () => setChange((d) => (d.run = { branch })));
      expect([branch, (YAML.parse(readFileSync(join(root, ".aidw/changes", ID, "change.yaml"), "utf8")) as { approval: { push?: unknown } }).approval.push]).toEqual([branch, undefined]);
      expect([branch, bash(`git push origin ${branch}`)]).toEqual([branch, branch === "aidw/app.T01" ? "deny" : "ask"]);
    }
  });

  it("never grants pushing the base itself", () => {
    approved(QUALITY_YAML + GRANTS.replace("base: main", "base: feature/x"), () => setChange((d) => (d.run = { branch: "feature/x" })));
    expect(bash("git push origin feature/x")).toBe("ask");
  });

  it("asks again when the granted remote points elsewhere than at approval", () => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/app.git"], { cwd: root });
    approved(QUALITY_YAML + GRANTS);
    expect(bash("git push -u origin aidw/app")).toBe("allow");
    expect(bash("gh pr create --base main --head aidw/app --repo acme/app")).toBe("allow");
    expect(bash("gh pr create --base main --head aidw/app --repo someone/app")).toBe("ask");
    const r = JSON.parse(cli("pr", ID, "--json").out) as { commands: string[] };
    expect(r.commands[1]).toMatch(/--repo acme\/app/);
    for (const c of r.commands) expect([c, bash(c)]).toEqual([c, "allow"]);
    execFileSync("git", ["remote", "set-url", "origin", "https://github.com/evil/app.git"], { cwd: root });
    expect(bash("git push -u origin aidw/app")).toBe("ask");
  });

  it("shows the branch on the gate page before approval", () => {
    write(root, `.aidw/changes/${ID}/quality.yaml`, QUALITY_YAML + GRANTS);
    write(root, `.aidw/changes/${ID}/tasks.yaml`, TASKS_YAML);
    write(root, ".aidw/run/pages/gate.yaml", `layout: gate\ntitle: Approve\nchange: ${ID}\nsections:\n  - id: scope\n    title: Scope\n    body: Booking.\n`);
    expect(cli("page", "render", "gate").code).toBe(0);
    expect(readFileSync(join(root, ".aidw/run/pages/gate.html"), "utf8")).toMatch(/push <code>aidw\/app<\/code>/);
  });
});

describe("aidw pr with the push grant", () => {
  it("pushes to the granted remote and targets the granted base", () => {
    approved(QUALITY_YAML + GRANTS.replace("remote: origin", "remote: upstream").replace("base: main", "base: develop"));
    const r = JSON.parse(cli("pr", ID, "--json").out) as { base: string; commands: string[] };
    expect(r.base).toBe("develop");
    expect(r.commands[0]).toBe("git push -u upstream aidw/app");
    expect(r.commands[1]).toMatch(/^gh pr create --base develop --head aidw\/app /);
    for (const c of r.commands) expect([c, bash(c)]).toEqual([c, "allow"]);
  });

  it("keeps origin and the recorded base without a grant", () => {
    approved(QUALITY_YAML);
    const r = JSON.parse(cli("pr", ID, "--json").out) as { base: string; commands: string[] };
    expect(r.base).toBe("main");
    expect(r.commands[0]).toBe("git push -u origin aidw/app");
  });
});

describe("gate without the push grant", () => {
  it("asks as before", () => {
    approved(QUALITY_YAML + "grants:\n  envelope: true\n");
    expect(bash("git push -u origin aidw/app")).toBe("ask");
    expect(bash("gh pr create --base main --head aidw/app")).toBe("ask");
    expect(bash("aidw pr app --create")).toBe("ask");
  });

  it("asks before approval even with a grant written", () => {
    write(root, `.aidw/changes/${ID}/quality.yaml`, QUALITY_YAML + GRANTS);
    expect(bash("git push -u origin aidw/app")).toBe("ask");
  });
});

describe("the grants are shown on the gate page and in the brief", () => {
  const GATE = `layout: gate\ntitle: Approve\nchange: ${ID}\nsections:\n  - id: scope\n    title: Scope\n    body: Booking.\n`;

  it("adds a Grants section to the gate Decision Page", () => {
    approved(QUALITY_YAML + GRANTS);
    write(root, ".aidw/run/pages/gate.yaml", GATE);
    expect(cli("page", "render", "gate").code).toBe(0);
    const html = readFileSync(join(root, ".aidw/run/pages/gate.html"), "utf8");
    expect(html).toMatch(/data-sec="grants"/);
    expect(html).toContain("aidw/app");
    expect(html).toMatch(/remote <code>origin<\/code>/);
    expect(html).toMatch(/base <code>main<\/code>/);
    expect(html).toMatch(/free resource/);
    expect(html).toMatch(/10 Agent runs/);
    expect(html).toMatch(/production deploys/);
  });

  it("says what still asks when nothing is granted, with the default cap", () => {
    approved(QUALITY_YAML);
    write(root, ".aidw/run/pages/gate.yaml", GATE);
    expect(cli("page", "render", "gate").code).toBe(0);
    const html = readFileSync(join(root, ".aidw/run/pages/gate.html"), "utf8");
    expect(html).toMatch(/Push and pull request<\/b>: not granted/);
    expect(html).toMatch(/6 Agent runs \(default: 3 per planned task\)/);
  });

  it("puts the envelope in the task brief", () => {
    approved(QUALITY_YAML + GRANTS);
    const r = cli("brief", "T01", "--change", ID);
    expect(r.code).toBe(0);
    const file = r.out.split("\n")[0] ?? "";
    const text = readFileSync(file.startsWith("/") ? file : join(root, file), "utf8");
    expect(text).toMatch(/## Permission envelope/);
    expect(text).toMatch(/reversible/);
    expect(text).toMatch(/Never automatic/);
  });

  it("leaves the brief as it was without a grant", () => {
    approved(QUALITY_YAML);
    const r = cli("brief", "T01", "--change", ID);
    const file = r.out.split("\n")[0] ?? "";
    expect(readFileSync(file.startsWith("/") ? file : join(root, file), "utf8")).not.toMatch(/Permission envelope/);
  });
});
