---
name: approve
description: Approve the Analysis package of an aidw change so autonomous execution can start. Only when the user runs /aidw:approve.
disable-model-invocation: true
argument-hint: "[change id]"
---

# aidw: approve the Analysis

The `aidw` CLI ships with this plugin as `${CLAUDE_PLUGIN_ROOT}/bin/aidw`. If a command fails with
`aidw: command not found`, run that path instead of `aidw` (here and in every command below).

The user has asked to approve. This is the single human gate of the workflow (Q2).

1. Run `aidw status`. Pick the change in `awaiting_approval` (or `$ARGUMENTS` if given). If none is waiting,
   say so and stop.
2. Run `aidw validate <id>` and `aidw analyze <id>`. If either fails, show the errors and stop: the package
   goes back to analysis (`aidw transition <id> analyzing`).
3. Show the user a short recap so they know exactly what they approve: the `## Summary`, `## Stack`
   (with its source), `## Design` mode, `## Deploy strategy`, `## Permissions`, and the number of tasks.
4. Run `aidw approve <id>`. The aidw gate turns this into a permission prompt: the user confirms it there.
   If the user declines the prompt, do not retry.
5. Report the approval hash. Explain that from now on:
   - the approved package (intake, analysis, specs, design, constitution) is frozen; changing it needs
     `aidw transition <id> escalated`, then `analyzing`, then a new approval;
   - autonomous execution starts with `/aidw:run` (one fresh implementer per task, checkpoint evidence,
     independent review, a commit per task); after an interruption, `/aidw:resume`;
   - the cheapest way to run it: the analysis conversation above is long and every later turn re-reads it.
     Either type `/clear` and then `/aidw:run`, or run `aidw run <id> --permission-mode auto` in a separate
     terminal (a fresh session per task, waits out usage limits). Say this in two lines; do not start the run
     yourself unless the user asks.
