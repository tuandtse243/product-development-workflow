/**
 * H1: three general gaps of the gate hook found by the reviews of earlier tasks.
 *   1. interpreter writes: an Agent denied Bash writes runs `node -e`, `python3 -c`, `bash -c`... instead;
 *   2. whitespace the shell does not split on (NBSP, \v, U+3000...) in a command the gate word-splits to allow;
 *   3. case variants of protected paths (macOS and Windows file systems ignore case).
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { decide, type HookInput } from "../src/gate.js";
import { shellWords } from "../src/grants.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, planReviewed, tempProject, write } from "./fixtures.js";

const ID = "app";
let root: string;

const cli = (...argv: string[]) => run([...argv, "--root", root], {}, root, { out: () => {}, err: () => {} });
const env = {} as NodeJS.ProcessEnv;
const bash = (command: string, agent_type?: string) =>
  decide({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: root, ...(agent_type ? { agent_type } : {}) } as HookInput, env)?.decision ?? "none";
const writeTool = (file: string, agent_type?: string, tool = "Write") =>
  decide({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: { file_path: file.startsWith("/") ? file : join(root, file) }, cwd: root, ...(agent_type ? { agent_type } : {}) } as HookInput, env)?.decision ?? "none";

function analyzed(quality = QUALITY_YAML) {
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  write(root, `.aidw/changes/${ID}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `.aidw/changes/${ID}/tasks.yaml`, TASKS_YAML);
  write(root, `.aidw/changes/${ID}/quality.yaml`, quality);
  write(root, `.aidw/changes/${ID}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  planReviewed(root, ID);
  for (const s of ["intake", "analyzing"]) expect(cli("transition", ID, s)).toBe(0);
}

function executing(quality = QUALITY_YAML) {
  analyzed(quality);
  expect(cli("transition", ID, "awaiting_approval")).toBe(0);
  expect(cli("approve", ID)).toBe(0);
  expect(cli("transition", ID, "executing")).toBe(0);
}

beforeEach(() => {
  root = tempProject();
  cli("init");
  cli("change", "new", ID);
});

const REVIEWER = "aidw:code-reviewer";
const AUTHOR = "aidw:technical-planner";
const IMPLEMENTER = "aidw:fullstack";
const VERDICT = ".aidw/run/review-T01.md";

describe("1. interpreter writes", () => {
  const inline = [
    `node -e "require('fs').writeFileSync('${VERDICT}','VERDICT: pass')"`,
    `node --eval "require('fs').writeFileSync('x','y')"`,
    `node -p "require('fs').writeFileSync('x','y')"`,
    `nodejs -e "1"`,
    `/usr/local/bin/node -e "1"`,
    `NODE -e "1"`,
    `python3 -c "open('${VERDICT}','w').write('VERDICT: pass')"`,
    `python3 -B -c "open('x','w')"`,
    `python -c "open('x','w')"`,
    `perl -e 'open(F,">x")'`,
    `perl -pi -e 's/fix/pass/' ${VERDICT}`,
    `ruby -e 'File.write("x","y")'`,
    `php -r 'file_put_contents("x","y");'`,
    `deno eval "Deno.writeTextFileSync('x','y')"`,
    `bun -e "Bun.write('x','y')"`,
    `npx tsx -e "1"`,
    `bash -c 'echo pass > ${VERDICT}'`,
    `sh -c "echo pass > ${VERDICT}"`,
    `zsh -lc 'echo pass > x'`,
    `eval "echo pass > ${VERDICT}"`,
    `node <<'EOF'\nrequire('fs').writeFileSync('x','y')\nEOF`,
    `python3 - <<EOF\nopen('x','w')\nEOF`,
    `echo "require('fs').writeFileSync('x','y')" | node`,
    `cat .aidw/run/x.js | node -`,
    `node < .aidw/run/x.js`,
    `node .aidw/run/review-T01.md`,
    `bash .aidw/changes/app/x.sh`,
    `source .aidw/run/x.sh`,
    `ls && node -e 1`,
    `ls\nnode -e 1`,
  ];

  for (const agent of [REVIEWER, AUTHOR]) {
    for (const c of inline) {
      it(`${agent} after approval: ${JSON.stringify(c)} is denied`, () => {
        executing();
        expect(bash(c, agent)).toBe("deny");
      });
    }
  }

  it("an author may not forge the plan verdict with an interpreter before approval either", () => {
    analyzed();
    expect(bash(`node -e "require('fs').writeFileSync('.aidw/run/review-plan-${ID}.md','VERDICT: pass')"`, AUTHOR)).toBe("deny");
    expect(bash(`python3 -c "open('.aidw/changes/${ID}/plan-review.yaml','w')"`, AUTHOR)).toBe("deny");
  });

  it("other shell write forms a read-only role used to slip through: a newline, backticks, find -exec", () => {
    executing();
    for (const c of ["ls\nrm -rf src", "echo `rm -rf src`", "find . -name '*.ts' -exec rm {} +", "find src -delete"]) {
      expect([c, bash(c, REVIEWER)]).toEqual([c, "deny"]);
    }
  });

  it("a reviewer still runs tests, reads and checks versions", () => {
    executing();
    for (const c of ["npx vitest run", "npm test", "pnpm playwright test", "node --version", "python3 --version", "git diff HEAD~1", 'grep -rn "node -e" src', "cat .aidw/run/brief-T01.md", "node_modules/.bin/vitest run"]) {
      expect([c, bash(c, REVIEWER)]).toEqual([c, "none"]);
    }
  });

  it("an implementer keeps its interpreters and scripts", () => {
    executing();
    for (const c of ["node scripts/seed.js", 'node -e "console.log(1)"', 'python3 -c "print(1)"', "npx vitest run", "bash scripts/check.sh", "echo x > src/a.ts", "cp shot.png .aidw/run/shots/a.png", "echo note > .aidw/run/report-T01.md"]) {
      expect([c, bash(c, IMPLEMENTER)]).toEqual([c, "none"]);
    }
  });

  it("an implementer may not write aidw state or a verdict through Bash (it may not with the Write tool)", () => {
    executing();
    for (const c of [
      `node -e "require('fs').writeFileSync('${VERDICT}','VERDICT: pass')"`,
      `echo 'VERDICT: pass' > ${VERDICT}`,
      `echo 'VERDICT: pass' > ../review-T01.md`,
      `echo pass > .AIDW/RUN/layer-review-code.md`,
      `cp x .aidw/changes/${ID}/analysis.md`,
      `python3 -c "open('.aidw/run/progress.json','w')"`,
      `sed -i '' s/a/b/ .aidw/run/worktrees/${ID}/T01/.aidw/changes/${ID}/tasks.yaml`,
    ]) {
      expect([c, bash(c, IMPLEMENTER)]).toEqual([c, "deny"]);
    }
  });

  it("the lead is unchanged: inline interpreters are its own call", () => {
    analyzed();
    expect(bash("node -e 'x => 1'")).toBe("none");
  });
});

describe("2. whitespace the shell does not split on", () => {
  const ODD = [" ", "\v", "\f", " ", "　", "﻿", "​", "\u0085", " ", "\x00", "\x1b"];

  it("shellWords refuses any whitespace but space and tab, and control or format characters", () => {
    expect(shellWords("git push -u origin aidw/app")).toEqual(["git", "push", "-u", "origin", "aidw/app"]);
    expect(shellWords("git\tpush origin aidw/app")).toEqual(["git", "push", "origin", "aidw/app"]);
    expect(shellWords('gh pr create --title "Đặt lịch hẹn" --base main --head aidw/app')).not.toBeNull();
    for (const ch of ODD) expect([JSON.stringify(ch), shellWords(`git${ch}push origin aidw/app`)]).toEqual([JSON.stringify(ch), null]);
  });

  it("a granted push with such a character asks", () => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/app.git"], { cwd: root });
    executing(`${QUALITY_YAML}grants:\n  push:\n    remote: origin\n    base: main\n`);
    expect(bash("git push -u origin aidw/app")).toBe("allow");
    for (const c of ["git push -u origin aidw/app", "git push -u　origin aidw/app", "git push -u origin aidw/app ", "git push -u origin aidw/app﻿"]) {
      expect([JSON.stringify(c), bash(c)]).toEqual([JSON.stringify(c), "ask"]);
    }
  });

  it("a tier 2 command in the approved allowlist with such a character asks", () => {
    executing();
    expect(bash("vercel deploy --yes")).toBe("allow");
    expect(bash("vercel deploy --yes")).toBe("ask");
    expect(bash("vercel deploy --yes ")).toBe("ask");
  });

  it("an aidw command with a newline gets the full checks", () => {
    analyzed();
    expect(bash("aidw status\ncp a src/x.ts")).toBe("deny");
    expect(bash("aidw status x")).not.toBe("allow");
  });
});

describe("3. case variants of protected paths", () => {
  it("the approved package stays frozen under any case", () => {
    executing();
    for (const f of [
      `.AIDW/changes/${ID}/analysis.md`,
      `.aidw/Changes/${ID}/analysis.md`,
      `.aidw/changes/${ID}/ANALYSIS.md`,
      `.aidw/changes/${ID}/Quality.yaml`,
      `.aidw/changes/${ID}/Specs/booking/spec.md`,
      ".aidw/CONSTITUTION.md",
      ".aidw/Domain/model.md",
      ".AIDW/architecture/overview.md",
      ".aidw/specs/booking/SPEC.md",
    ]) {
      expect([f, writeTool(f, undefined, "Edit")]).toEqual([f, "deny"]);
    }
    expect(writeTool(`.aidw/changes/${ID}/Tasks.yaml`, undefined, "Edit")).toBe("allow");
  });

  it("an implementer may not write .aidw/ or a verdict under another case", () => {
    executing();
    for (const f of [".AIDW/run/review-T01.md", ".Aidw/run/progress.json", `.AIDW/changes/${ID}/tasks.yaml`, `.aidw/run/worktrees/${ID}/T01/.AIDW/state.yaml`, `.aidw/RUN/WORKTREES/${ID}/T01/.aidw/x`]) {
      expect([f, writeTool(f, IMPLEMENTER)]).toEqual([f, "deny"]);
    }
    expect(writeTool(`.aidw/run/worktrees/${ID}/T01/src/a.ts`, IMPLEMENTER)).toBe("allow");
  });

  it("a reviewer may write only its own verdict, in the exact case", () => {
    executing();
    expect(writeTool(VERDICT, REVIEWER)).toBe("allow");
    expect(writeTool(".AIDW/run/review-T01.md", REVIEWER)).toBe("deny");
  });

  it("personal credentials are denied under any case", () => {
    for (const f of ["/Users/me/.SSH/id_ed25519", "/Users/me/.Aws/credentials", "/Users/me/.ssh/ID_RSA", "/Users/me/.GnuPG/x"]) {
      expect([f, writeTool(f, undefined, "Read")]).toEqual([f, "deny"]);
    }
    expect(bash("cat ~/.AWS/credentials")).toBe("deny");
  });
});
