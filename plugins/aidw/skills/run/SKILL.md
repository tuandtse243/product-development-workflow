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
3. Not running under the runner (`echo $AIDW_RUNNER` is empty) and more than 3 tasks remain: tell the user once,
   in one line, that `aidw run <id>` in their own terminal does the same with a fresh session per task and costs
   about a quarter of the tokens of this long session; then continue here if they do not switch.

## 1. Loop

Repeat until `aidw next` says `complete` or `escalate`:

```
aidw next --change <id> --json
```

**`implement <T>`** (reason `new`, `retry` or `interrupted`):
1. `aidw task start <T> --change <id>`. It prints the brief path and the exact prompt to use. If it fails
   because attempts are exhausted, go to *Escalate*.
2. Spawn the `aidw:implementer` subagent (Agent tool, `subagent_type: "aidw:implementer"`) with the printed
   prompt (`Task brief: <path>. Read it and implement the task.`). Wait for it.
3. If the implementer reports a blocker it cannot resolve (missing decision, contradictory spec, credential),
   go to *Escalate* with its words.
4. `aidw checkpoint <T> --change <id>`. Read its last lines:
   - FAIL: the task is marked failed with the reason. It prints `NEXT: implement <T> (retry)`; loop (the retry
     brief carries the failure and the debugging skill).
   - PASS with `auto-passed`: a converge task that only added tests; it is reviewed and committed already.
     Follow the printed `NEXT:`.
   - PASS with `SPAWN aidw:reviewer`: go to the review step below.

**`review <T>`**:
1. The checkpoint printed the review brief and prompt (if you only have `NEXT: review <T>`, run
   `aidw brief <T> --change <id> --for review`). Spawn the `aidw:reviewer` subagent with
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
3. Spawn one `aidw:implementer` per task **in a single message** (parallel Agent calls), each with only its
   printed prompt (`Task brief: <path>. Read it and implement the task.`). Wait for all of them.
4. A blocker from any implementer: finish the others, then *Escalate*.
5. `aidw checkpoint <T>` for each task, one after the other (checkpoints run builds; never in parallel).
6. Each passing checkpoint printed its review prompt. Spawn the reviewers of all passing tasks in one message,
   then `aidw verdict <T>` for each, one after the other.
   `aidw review <T> pass` merges the task's worktree into the change branch and commits it. If the merge
   conflicts, the output says so: the task's work is dropped and it reruns sequentially later (say so to the
   user in one line).

**`integrate <T1>, <T2>, ...`** (a wave was merged): `aidw integrate --change <id>`. It runs the wave's verify
commands and the `code` layer on the merged code.
- `PASS`: loop.
- `FAIL` with a fix task `Inn`: loop; `next` returns it before anything else (it runs on the main checkout).
- Fix rounds exhausted: the change is `escalated`; tell the user (section 2, step 2) and stop.

**`escalate`**: see below.

**`complete`**: go to *Finish*.

## 2. Escalate

1. `aidw transition <id> escalated --reason "<short reason>"`.
2. Tell the user what is blocked and why (task, attempts, the last checkpoint failure or review notes from
   `.aidw/changes/<id>/evidence/<T>.json`), and the options:
   - fix the cause yourself or give the missing decision, then `/aidw:resume`;
   - change scope: `aidw transition <id> analyzing`, revise the Analysis, approve again.
3. Stop.

## 3. Verify (quality layers)

1. `aidw transition <id> verifying` (refused while any task is not done).
2. `aidw verify --change <id>`. It runs the layers of the approved `quality.yaml` in order (code, unit,
   integration, e2e, ui-ux, a11y, security, performance, ...), skipping layers that already passed on the
   current code.
   - `PASS`: go to section 4.
   - A layer failed and a **fix task** `Qnn` was added: the change is back in `executing`. Return to the loop
     (section 1): the fix task runs through implement, checkpoint and review like any other, then come back here.
   - `REVIEW`: a **review layer** (`review: ui` or `review: security`) passed its commands and waits for an
     independent reviewer. The output names the agent, the brief and the prompt:
     1. Spawn that agent (`subagent_type: "aidw:ui-reviewer"` or `"aidw:security-reviewer"`) with exactly the
        printed prompt: `Layer review brief: <path>. Review the layer and reply with the verdict.`
     2. The reviewer writes its verdict to `.aidw/run/layer-review-<layer>.md` and replies with one line. Run
        `aidw layer-review <layer> --change <id>` (no verdict argument): it reads that file and records
        `pass` or `fix`, keeping the non-blocking remarks for the quality report and the handoff. No clear
        verdict: spawn a fresh reviewer once more; still unclear, record `fix` with
        `aidw layer-review <layer> fix --notes-file <file>`.
     3. `pass` -> run `aidw verify` again for the remaining layers. `fix` -> a fix task `Qnn` was added with the
        reviewer's notes; return to the loop (section 1), then come back here. Fix rounds exhausted -> the change
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

It loops `claude -p "/aidw:resume <id>"` until the change is archived, **one task per session** (a fresh session
starts at about 55K tokens instead of carrying hundreds of thousands), waits out each limit (the reset time from
the error, or 5 to 60 minutes of backoff), and stops on escalation or when two sessions make no progress
(log: `.aidw/run/runner.log`). Tier-3 questions cannot be answered headless; they end in an escalation.

## Long-running commands

`aidw checkpoint`, `aidw verify`, `aidw deploy` (and Playwright screenshots) run builds and test suites. Call them with the Bash tool's
maximum timeout (600000 ms). If one may take longer, run it in the background and wait for its completion
notification instead of polling. A verify killed half-way loses nothing: the next call skips layers that
already passed.
