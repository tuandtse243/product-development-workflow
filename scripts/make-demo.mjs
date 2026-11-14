// Creates a small demo project to try the whole aidw flow on (init, start, approve, run, browser, deliver).
//
//   node scripts/make-demo.mjs <target-dir> [--no-install]
//
// Copies evals/demo/todo-board (a tiny Next.js app with unit and e2e tests that are known to pass), makes it a git
// repository, installs the packages, runs `aidw init` and commits everything, so the working tree is clean for
// /aidw:start. The target directory must not exist or must be empty. Nothing is deployed and no cloud resource is made.
import { cpSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(repo, "evals/demo/todo-board");
const plugin = join(repo, "plugins/aidw");
const aidw = join(plugin, "bin/aidw");

const args = process.argv.slice(2);
const noInstall = args.includes("--no-install");
const target = args.find((a) => !a.startsWith("--"));
if (!target) {
  console.error("usage: node scripts/make-demo.mjs <target-dir> [--no-install]");
  process.exit(2);
}
const dir = resolve(target);
if (existsSync(dir) && readdirSync(dir).length > 0) {
  console.error(`${dir} exists and is not empty; choose a new directory`);
  process.exit(1);
}
if (!existsSync(aidw)) {
  console.error(`${aidw} is missing: run \`npm run build\` in ${repo} first`);
  process.exit(1);
}

const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { cwd: dir, stdio: ["ignore", "inherit", "inherit"], ...opts });
const git = (...argv) => run("git", ["-c", "user.name=aidw demo", "-c", "user.email=demo@example.invalid", ...argv]);

const REQUEST = "On the home page, show how many todos are done under the title, like \"1 of 3 done\". Hide it when the list is empty. Keep it small: no new dependencies and no deploy.";

cpSync(template, dir, { recursive: true });
writeFileSync(
  join(dir, "DEMO.md"),
  `# aidw demo: Todo board

A tiny Next.js app (in-memory todos, a unit test, one e2e test). Use it to try aidw end to end.

## The request

\`\`\`
${REQUEST}
\`\`\`

(Any language works: aidw answers in yours.) It is a small change: one capability (\`todos\`) is modified, so the
Analysis writes its baseline spec first; expect 2 or 3 tasks, the \`code\`, \`unit\` and \`e2e\` layers, and no deploy.

## Steps

1. Start the test browser (once; \`aidw run\` does this itself): \`aidw browser start\`
2. In this directory run \`claude --plugin-dir ${plugin}\`
3. \`/aidw:start <the request above>\`, answer its questions, then \`/aidw:approve\`
4. \`/aidw:run\`, or leave it to the runner: \`aidw run <change-id> --permission-mode auto -- --plugin-dir ${plugin}\`
5. When it finishes: \`/aidw:deliver\` (the runner calls it), then read \`.aidw/archive/\`

## What to look for

- \`aidw roster\` is clean; \`/aidw:start\` reads the Role profiles (\`roles/*/role.md\`) and \`aidw validate\` and \`aidw analyze\` pass
- the e2e layer connects to the test browser through \`E2E_CDP_URL\` (no fixed port)
- the agents \`aidw:fullstack\` and \`aidw:code-reviewer\` run, and the reviewer cannot edit files
- each task becomes one commit on the branch \`aidw/<change-id>\`; \`main\` is never touched
`,
);

git("init", "-q", "-b", "main");
git("add", "-A");
git("commit", "-q", "-m", "chore: todo board demo");

if (!noInstall) {
  console.log("installing packages (about a minute)...");
  run("pnpm", ["install"]);
  git("add", "-A");
  git("commit", "-q", "-m", "chore: lockfile");
}

run("node", [aidw, "init"], { stdio: ["ignore", "ignore", "inherit"] });
git("add", "-A");
git("commit", "-q", "-m", "chore: aidw init");

console.log(`
Demo ready: ${dir}

  cd ${dir}
  ${aidw} browser start        # once; or let \`aidw run\` start it
  claude --plugin-dir ${plugin}

then, in Claude Code:

  /aidw:start ${REQUEST}

Steps and what to check are in ${join(dir, "DEMO.md")}.`);
