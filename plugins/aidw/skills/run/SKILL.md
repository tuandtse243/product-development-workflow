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

## 3. Finish

1. `aidw transition <id> verifying`.
2. Summarize for the user: tasks done, commits (`git log --oneline` since the first task's base), retries and
   reviewer findings worth knowing, files changed outside touches.
3. The quality layers (build, unit, integration, E2E, preview deploy) run in the `verifying` state; they arrive
   with workflow slice S4. Until then, stop here.
