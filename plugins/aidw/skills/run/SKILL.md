---
name: run
description: Execute an approved aidw change autonomously - one fresh implementer subagent per task, machine-checked evidence, an independent reviewer, one commit per task. Use when the user runs /aidw:run.
allowed-tools: Bash(aidw *)
disable-model-invocation: true
argument-hint: "[change id]"
---

# aidw: run the approved task graph

The `aidw` CLI ships with this plugin as `${CLAUDE_PLUGIN_ROOT}/bin/aidw`. If a command fails with
`aidw: command not found`, run that path instead of `aidw` (here and in every command below).

You are the **orchestrator**. You run in the main session, write no product code, and keep your own context
thin: the work happens in fresh subagents, the state lives in `.aidw/` and git. A killed session therefore
loses nothing: `/aidw:resume` re-enters this loop.

This is Pocock's `implement-spec` pattern (task graph, frontier, a fresh subagent per ticket, communication
through context pointers) wrapped with aidw governance: approval gate, per-task evidence, independent review,
commit per task. Tasks whose `touches` do not overlap run as a **parallel wave**, each in its own git worktree
that aidw creates; everything else runs sequentially on the main checkout.

## Ground rules

- Every state change goes through the `aidw` CLI. Never hand-edit `tasks.yaml`, `change.yaml` or evidence.
- Do not read or write source code yourself, and do not paste code into subagent prompts. Pass the brief path.
- Keep subagent replies short; do not re-verify their work by reading code. `aidw checkpoint` and the reviewer
  are the verification.
- **Your context is the cost.** Every turn you take re-reads everything before it, so each avoidable command is
  expensive. Run only what this skill says, one command per step; never `cat` or `sed` a skill, profile or brief
  into the session (subagents read those themselves); never run `aidw status`/`aidw next` when the previous
  command already printed `NEXT:`.
- Reviewers write their verdict to a file and reply with one line; do not read the file. `aidw verdict` does.
- The aidw gate still applies: tier-3 actions (production deploy, pushing, paid resources) ask the user.
- Talk to the user in their language; keep status lines short (`T03 done (2/8)`).
- Spawn subagents with the prompt given below and nothing else: the brief already carries failures, review
  notes, decisions and design. If another plugin's hook rewrites the Agent input and auto mode asks you to
  resend it, resend that input once, verbatim, and mention once to the user that the plugin costs an extra
  call per subagent.

## 0. Enter execution

1. `aidw status`. Pick the change (`$ARGUMENTS`, or the single change that is `approved`/`executing`/`paused`).
   - `approved`: `aidw transition <id> executing`
   - `paused`: `aidw transition <id> resume`
   - `executing`: continue.
   - drift, `awaiting_approval` or earlier: stop and tell the user (`/aidw:status` explains what to do).
   - The transition puts HEAD on the change branch (`aidw/<id>`, or the feature branch the user was on) and
     prints where task commits go. If it says switching failed, stop and tell the user.
2. When the project is a git repository, check `git status`: unrelated uncommitted user changes would end up in
   task commits. If there are any, ask the user to commit or stash them first.
3. **Preflight (once per change, before the first task).** Run `aidw doctor <id>`. Greenfield tasks install
   packages and the last step deploys; both fail inside the sandbox in known ways (trial-3A lost over an hour):
   - FAIL: stop and tell the user what to fix (the line says how), then run it again.
   - `package install` FAIL: packages cannot be installed from here (a scanner, a proxy, the sandbox). No implementer can fix
     that. Give the user the line as it is, and do not spawn anything until `aidw doctor <id> --fresh` passes.
     Offer the shortest way out first: `aidw run <id> --detach` in the user's own terminal. The runner probes from the
     user's terminal, and its headless sessions run in auto mode, where a command the sandbox blocks can be run again
     outside it without waiting for a person (seen on real runs: in-session installs failed for hours with scanner
     timeouts, 502 and 407 from the sandbox proxy; the same scaffold installed in ten minutes under `aidw run`).
     The probe installs one tiny package, so it can pass while a large install (`next`) still times out:
     if an implementer's install fails after a passing probe, treat it as the same blocker and offer `aidw run`.
     Do not try other package managers, flags or settings changes to get around a scanner or proxy: those are the
     user's policy, not a bug to route around.
   - `pnpm store` WARN (not writable): ask the user to run the first `pnpm install` in their own terminal after
     T01's `package.json` exists, or to allow the path; do not let T01 sit waiting.
   - `chrome cdp` FAIL: no Chromium-family browser can start inside this session's sandbox (macOS denies it
     registering its processes), so the project's test browser has to be started outside it. Tell the user to run
     `! aidw browser start` once, or to use `aidw run`, which starts the browser itself because the runner is not
     sandboxed. Do not try to launch Chrome from here.
   - `vercel project` WARN (not linked): run `vercel link --yes` now (creating a free project is covered by the
     `vercel-preview` permission). Without it the first deploy is forced to Production, which is tier 3.
4. Not running under the runner (`echo $AIDW_RUNNER` is empty) and more than 3 tasks remain: **recommend the runner first**:
   tell the user once, in one line, that typing `aidw doctor <id>` and then `aidw run <id> --permission-mode auto` in
   their own terminal builds everything by itself, one fresh session per task, for about a quarter of the tokens of
   this long session. Then continue here if they do not switch.

## Token discipline (this session re-reads its whole context on every turn)

Trial-3A: 186 orchestrator turns re-read a context that grew from 51K to 300K tokens; that was 57% of the cost.

- Every aidw command prints a `NEXT:` or `SPAWN` line: follow it. Do not call `aidw next` or `aidw status` in between.
- After spawning subagents, end the turn with one short line (`Waiting for T03.`), never with no text: an empty
  turn makes Claude Code ask for a visible reply, which costs a whole extra turn (seen on a real run). Do not
  narrate waiting or restate what a result said.
- Run independent aidw commands in one Bash call (`aidw checkpoint T02; aidw checkpoint T03`), and spawn every
  ready subagent in one message. Do not Read files a brief already summarizes.
- A fix task of a layer that has its own reviewer is auto-reviewed: do not spawn a reviewer for it.
- With more than 3 tasks left, the cheapest path is `aidw run <id>` in the user's terminal (fresh session per task,
  no MCP servers). Say so once.

## 1. Loop

Repeat until `aidw next` says `complete` or `escalate`:

```
aidw next --change <id> --json
```

**`implement <T>`** (reason `new`, `retry` or `interrupted`):
1. `aidw task start <T> --change <id>`. It prints the brief path and the exact prompt to use. If it fails
   because attempts are exhausted, go to *Escalate*.
2. Spawn the Agent named on the `SPAWN` line of `task start` (Agent tool, `subagent_type: "<that name>"`: `aidw:fullstack`,
   `aidw:frontend` or `aidw:backend`, from the task's `role`) with the printed
   prompt (`Task brief: <path>. Read it and implement the task.`). Wait for it.
3. If the implementer reports a blocker it cannot resolve (missing decision, contradictory spec, credential),
   go to *Escalate* with its words.
   A package install or build tool that fails for a reason outside the code (the network, a package scanner that
   times out, a sandbox denial) is such a blocker too: escalate at once with the exact error. Never spawn an
   implementer to find out whether the environment was fixed (two minutes and its tokens each time): run
   `aidw doctor <id> --fresh` (ten seconds). `aidw transition <id> executing` also refuses to resume while its
   `package install` check fails, and prints what the user must change.
4. `aidw checkpoint <T> --change <id>`. Read its last lines:
   - FAIL: the task is marked failed with the reason. It prints `NEXT: implement <T> (retry)`; loop (the retry
     brief carries the failure and the debugging skill).
   - BLOCKED (environment): a check failed because the machine refused it (the sandbox denied a file lock, a proxy
     answered 407 or 502, a package scanner timed out), not because of the code. The task stays running and no
     attempt is used. Run the same `aidw checkpoint` once more outside the sandbox (`dangerouslyDisableSandbox: true`;
     auto mode allows it, an interactive session asks the user). If it is blocked again, go to *Escalate* with the
     printed line. Never start a new attempt or spawn the implementer again for it.
   - PASS with `auto-passed`: a converge task that only added tests; it is reviewed and committed already.
     Follow the printed `NEXT:`.
   - PASS with `SPAWN aidw:code-reviewer`: go to the review step below.

**`review <T>`**:
1. The checkpoint printed the review brief and prompt (if you only have `NEXT: review <T>`, run
   `aidw brief <T> --change <id> --for review`). Spawn the `aidw:code-reviewer` subagent with
   `Review brief: <path>. Review the task and reply with the verdict.`
2. The reviewer writes its verdict to `.aidw/run/review-<T>.md` and replies with its first line. Run
   `aidw verdict <T> --change <id>`: it reads that file, records `pass` (marks done, commits the task, keeps the
   reviewer's non-blocking remarks for the handoff) or `fix` (the retry brief carries the notes), and prints
   `NEXT:`.
   - It fails with "no verdict file" or "does not start with VERDICT": spawn a fresh reviewer once more; if
     still unclear, save its reply to that file yourself and, as a last resort,
     `aidw review <T> fix --notes-file <file> --change <id>`.
3. Report one line to the user: `T03 done (3/8)` or `T03 needs fixes (attempt 2/3)`.
4. **`END THIS SESSION`** in the output (only under `aidw run`): reply with one line and stop, calling no more
   tools. The runner starts a fresh session for the next task. Do not continue the loop.

**`wave <T1>, <T2>, ...`** (tasks that can run side by side):
1. For each task: `aidw task start <T> --worktree --change <id>`. If one fails because its worktree setup
   failed, it is marked sequential and runs later on its own; continue with the others.
2. Each `task start` printed the brief path and prompt.
3. Spawn one Agent per task, the one named on its `SPAWN` line, **in a single message** (parallel Agent calls), each with only its
   printed prompt (`Task brief: <path>. Read it and implement the task.`). Wait for all of them.
4. A blocker from any implementer: finish the others, then *Escalate*.
5. `aidw checkpoint <T>` for each task, one after the other (checkpoints run builds; never in parallel).
6. Each passing checkpoint printed its review prompt. Spawn the reviewers of all passing tasks in one message,
   then `aidw verdict <T>` for each, one after the other.
   `aidw review <T> pass` merges the task's worktree into the change branch and commits it. If the merge
   conflicts, the output says so and `NEXT:` is `resolve <T>` (below); say so to the user in one line.

**`resolve <T>`** (a wave task's merge conflicted with a task already merged; its work is kept):
1. `aidw brief <T> --for conflict --change <id>`. It merges the change branch into the task's worktree and prints the
   brief path and the `SPAWN aidw:integration` line.
2. Spawn `aidw:integration` with the printed prompt (`Conflict brief: <path>. Read it and resolve the conflict.`) and
   nothing else. Wait for it.
3. `aidw resolve <T> --change <id>`: it checks the resolution, commits the merge in the worktree and runs both tasks'
   checks again. `RESOLVED`: it printed the merge review brief and `SPAWN aidw:code-reviewer`; spawn it with the printed
   prompt, then `aidw verdict <T> --change <id>` (pass merges the task). `DROPPED`: the task reruns sequentially later;
   follow the printed `NEXT:`.
If only `NEXT: review the merge of <T>` is left (a new session), run `aidw brief <T> --for merge-review --change <id>` and
continue at the reviewer. A `fix` verdict on the merge drops the task too: no retry of the integration Role.

**`integrate <T1>, <T2>, ...`** (a wave was merged): `aidw integrate --change <id>`. It runs the wave's verify
commands and the `code` layer on the merged code.
- `PASS`: loop.
- `FAIL` with a fix task `Inn`: loop; `next` returns it before anything else (it runs on the main checkout).
- Fix rounds exhausted: the change is `escalated`; tell the user (section 2, step 2) and stop.

**`triage <T>`** (the task used all its attempts): an independent diagnosis comes before the user hears about it.
1. `aidw brief <T> --for triage --change <id>`. It prints the brief path and the `SPAWN` line.
2. Spawn the Agent named there (`aidw:software-architect`) with the printed prompt and nothing else. It reads the
   evidence of every attempt and writes `.aidw/run/triage-<T>.md` (first line `CAUSE: ...`).
3. `aidw triage <T> --change <id>` records it and applies the rule of the cause:
   - `implementation`: one further attempt with the diagnosis in its brief. Follow the printed `NEXT:`.
   - `environment`: the task is escalated; the output names what the user must fix.
   - `plan`, `spec`, `architecture`: the task is escalated; the approved package would change. Do not retry.
   Escalated: go to *Escalate* and give the user the diagnosis (`.aidw/run/triage-<T>.md`) with its cause.
4. No clear `CAUSE:` line: spawn it once more; still unclear, escalate with the task's own notes.
A task is triaged once: if the extra attempt fails too, it escalates without another triage.

**`escalate`**: see below.

**`complete`**: go to *Finish*.

## 2. Escalate

1. `aidw transition <id> escalated --reason "<short reason>"`.
2. Tell the user what is blocked and why (task, attempts, the triage diagnosis in `.aidw/run/triage-<T>.md` when there is
   one, else the last checkpoint failure or review notes from `.aidw/changes/<id>/evidence/<T>.json`), and the options:
   - fix the cause yourself or give the missing decision, then `/aidw:resume`;
   - change scope: `aidw transition <id> analyzing`, revise the Analysis, approve again.

   When the task was triaged with the cause `plan`, `spec` or `architecture`, the decision is the user's and has
   alternatives: run `aidw page triage <T> --change <id> --lang <en|vi>` and give them its link with two lines (what
   stopped, what the page asks) instead of listing the options in the chat. Under `AIDW_RUNNER=1` nobody is there to
   open a page: skip it; `/aidw:resume` shows it when the user is back.
3. Stop.

## 3. Verify (quality layers)

1. `aidw transition <id> verifying` (refused while any task is not done).
2. `aidw verify --change <id>`. It runs the layers of the approved `quality.yaml` in order (code, unit,
   integration, e2e, ui-ux, a11y, security, performance, ...), skipping layers that already passed on the
   current code.
   - `PASS`: go to section 4.
   - A layer failed and a **fix task** `Qnn` was added: the change is back in `executing`. Return to the loop
     (section 1): the fix task runs through implement, checkpoint and review like any other, then come back here.
   - `REVIEW`: one or more **review layers** (`review: ui`, `review: security` or `review: performance`) passed their commands and
     wait for independent reviewers. The output names, for each, the agent, the brief and the prompt; with two or more it
     names the layer too and ends with a `NEXT:` line (the CLI already left out a second browser user and anything past
     `parallel.max`; the rest come in the next round):
     1. Spawn each named agent (`subagent_type: "aidw:ui-ux-designer"`, `"aidw:security"` or `"aidw:performance"`, as the command names it), **all in
        one message** (parallel Agent calls, one per layer), each with exactly its printed prompt:
        `Layer review brief: <path>. Review the layer and reply with the verdict.`
     2. Each reviewer writes its verdict to `.aidw/run/layer-review-<layer>.md` and replies with one line. For each, as it
        returns, run `aidw layer-review <layer> --change <id>` (no verdict argument): it reads that file and records
        `pass` or `fix`, keeping the non-blocking remarks for the quality report and the handoff. No clear
        verdict: spawn a fresh reviewer once more; still unclear, record `fix` with
        `aidw layer-review <layer> fix --notes-file <file>`.
     3. Record every verdict of the group first, also after one of them was `fix`: the `pass` verdicts first, then the
        `fix` ones. If a `fix` verdict escalates the change (its fix rounds are exhausted), record no more verdicts: the
        others stay in `.aidw/run/layer-review-<layer>.md`, name them to the user with the escalation, and after
        `/aidw:resume` `aidw verify` offers those layers again. All `pass` -> run `aidw verify` again for
        the remaining layers. A `fix` -> a fix task `Qnn` was added with the reviewer's notes; return to the loop
        (section 1), then come back here. Fix rounds exhausted -> the change
        is `escalated`: tell the user and stop.
   - Fix rounds exhausted: the change is already `escalated`. Tell the user (section 2, step 2) and stop.
3. Do not edit quality.yaml, skip a layer or weaken a test to get green: the package is frozen and the gate
   denies it. If a layer cannot pass for a reason outside the code (missing Docker, missing login), escalate.

## 4. Converge

1. `aidw transition <id> converging` (refused unless every layer passed on the current code).
2. `aidw converge --change <id>`: every scenario this change adds or modifies must have a passing test
   (from the layers' JUnit reports when configured, otherwise a non-skipped test naming the scenario id).
   - `PASS`: go to section 5.
   - `GAPS` with converge tasks `Cnn` added: the change is back in `executing`. Return to the loop (section 1);
     after the tasks, verify (section 3) and converge again.
   - A scenario still without a passing test after its converge task: the change is `escalated`. Tell the user.

## 5. Deploy and deliver

1. `aidw transition <id> deploying` (refused without a passing converge on the current code), then
   `aidw deploy --change <id>`.
   - target `preview`: runs the approved deploy command and the smoke checks; prints the URL.
   - target `none` / `local`: records that nothing was deployed.
   - `DEPLOY FAILED`: if the error carries a hint (e.g. "the user runs `vercel whoami` in their own terminal"),
     tell the user exactly that and wait: the change stays in `deploying`, and you run `aidw deploy` again when
     they say it is done. Otherwise escalate with the output. Do not retry with different commands: anything
     beyond the approved command needs the user.
2. `aidw transition <id> delivered` (refused without a successful deploy record; commits `.aidw/`).
3. Follow `$(aidw plugin-path skills/deliver/SKILL.md)`: delivery package, screenshots, check, archive.
4. Final report to the user: tasks and commits, quality layers and fix rounds, converge result, the preview
   URL, known issues, and where the delivery package is.

## Unattended runs (usage limits)

If the user wants the run to survive usage or rate limits without them, tell them to start the runner in
their own terminal (never run it yourself; the gate denies it):

```
aidw run <id> --permission-mode auto -- --plugin-dir <plugin dir if not installed>
```

Before every session the runner prepares what a sandboxed session cannot do: it starts the project's test browser
(`aidw browser start`, a free port, one profile per project) when a layer drives a browser, and stops it when the
change is archived. The sessions then connect to it over localhost. It loops `claude -p "/aidw:resume <id>"` until the change is archived, **one task per session** (a fresh session
starts at about 55K tokens instead of carrying hundreds of thousands), waits out each limit (the reset time from
the error, or 5 to 60 minutes of backoff), and stops on escalation or when two sessions make no progress
(log: `.aidw/run/runner.log`). Tier-3 questions cannot be answered headless; they end in an escalation.

## Long-running commands

`aidw checkpoint`, `aidw verify`, `aidw deploy` (and Playwright screenshots) run builds and test suites. Call them with the Bash tool's
maximum timeout (600000 ms). If one may take longer, run it in the background and wait for its completion
notification instead of polling. A verify killed half-way loses nothing: the next call skips layers that
already passed.
