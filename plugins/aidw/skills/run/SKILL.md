---
name: run
description: Execute an approved aidw change autonomously - one fresh implementer subagent per task, machine-checked evidence, an independent reviewer, one commit per task. Use when the user runs /aidw:run.
disable-model-invocation: true
argument-hint: "[change id]"
---

# aidw: run the approved task graph

You are the **orchestrator**. You run in the main session, write no product code, and keep your own context
thin: the work happens in fresh subagents, the state lives in `.aidw/` and git. A killed session therefore
loses nothing: `/aidw:resume` re-enters this loop.

This is Pocock's `implement-spec` pattern (task graph, frontier, a fresh subagent per ticket, communication
through context pointers) wrapped with aidw governance: approval gate, per-task evidence, independent review,
commit per task. In this slice tasks run **sequentially**; parallel waves come later.

## Ground rules

- Every state change goes through the `aidw` CLI. Never hand-edit `tasks.yaml`, `change.yaml` or evidence.
- Do not read or write source code yourself, and do not paste code into subagent prompts. Pass the brief path.
- Keep subagent replies short; do not re-verify their work by reading code. `aidw checkpoint` and the reviewer
  are the verification.
- The aidw gate still applies: tier-3 actions (production deploy, pushing, paid resources) ask the user.
- Talk to the user in their language; keep status lines short (`T03 done (2/8)`).

## 0. Enter execution

1. `aidw status`. Pick the change (`$ARGUMENTS`, or the single change that is `approved`/`executing`/`paused`).
   - `approved`: `aidw transition <id> executing`
   - `paused`: `aidw transition <id> resume`
   - `executing`: continue.
   - drift, `awaiting_approval` or earlier: stop and tell the user (`/aidw:status` explains what to do).
2. When the project is a git repository, check `git status`: unrelated uncommitted user changes would end up in
   task commits. If there are any, ask the user to commit or stash them first.

## 1. Loop

Repeat until `aidw next` says `complete` or `escalate`:

```
aidw next --change <id> --json
```

**`implement <T>`** (reason `new`, `retry` or `interrupted`):
1. `aidw task start <T> --change <id>`. If it fails because attempts are exhausted, go to *Escalate*.
2. `aidw brief <T> --change <id>` prints the brief path.
3. Spawn the `aidw:implementer` subagent (Agent tool, `subagent_type: "aidw:implementer"`) with the prompt:
   `Task brief: <path>. Read it and implement the task.` Wait for it.
4. If the implementer reports a blocker it cannot resolve (missing decision, contradictory spec, credential),
   go to *Escalate* with its words.
5. `aidw checkpoint <T> --change <id>`. On FAIL the task is marked failed with the reason; just loop
   (`next` returns a retry, whose brief carries the failure and the debugging skill).

**`review <T>`**:
1. `aidw brief <T> --change <id> --for review` prints the review brief path.
2. Spawn the `aidw:reviewer` subagent with: `Review brief: <path>. Review the task and reply with the verdict.`
3. Read the first line of its reply.
   - `VERDICT: pass` -> `aidw review <T> pass --change <id>` (marks done and commits the task).
   - `VERDICT: fix` -> write the reply verbatim to `.aidw/run/review-<T>.md`, then
     `aidw review <T> fix --notes-file .aidw/run/review-<T>.md --change <id>`. Loop: the retry brief carries
     the notes.
   - No clear verdict: spawn a fresh reviewer once more; if still unclear, treat it as `fix` with its reply.
4. Report one line to the user: `T03 done (3/8)` or `T03 needs fixes (attempt 2/3)`.

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
   integration, e2e, ...), skipping layers that already passed on the current code.
   - `PASS`: go to step 4.
   - A layer failed and a **fix task** `Qnn` was added: the change is back in `executing`. Return to the loop
     (section 1): the fix task runs through implement, checkpoint and review like any other, then come back here.
   - Fix rounds exhausted: the change is already `escalated`. Tell the user (section 2, step 2) and stop.
3. Do not edit quality.yaml, skip a layer or weaken a test to get green: the package is frozen and the gate
   denies it. If a layer cannot pass for a reason outside the code (missing Docker, missing login), escalate.

## 4. Converge, deploy, deliver

1. `aidw transition <id> converging` (refused unless every layer passed on the current code). Converge (every
   scenario has a passing test, gaps become tasks) arrives with workflow slice S5; for now continue.
2. `aidw transition <id> deploying`, then `aidw deploy --change <id>`.
   - target `preview`: runs the approved deploy command and the smoke checks; prints the URL.
   - target `none` / `local`: records that nothing was deployed.
   - `DEPLOY FAILED`: escalate with the output (usually a missing provider login or env var). Do not retry with
     different commands: anything beyond the approved command needs the user.
3. `aidw transition <id> delivered` (refused without a successful deploy record).
4. Report to the user: tasks and commits (`git log --oneline` since the first task's base), quality layers and
   fix rounds, the preview URL, reviewer findings worth knowing, files changed outside touches. The delivery
   package and archive come with slice S5.

## Long-running commands

`aidw checkpoint`, `aidw verify` and `aidw deploy` run builds and test suites. Call them with the Bash tool's
maximum timeout (600000 ms). If one may take longer, run it in the background and wait for its completion
notification instead of polling. A verify killed half-way loses nothing: the next call skips layers that
already passed.
