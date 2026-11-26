---
name: status
description: Show where aidw changes stand - state, approval, drift, tasks and validation findings. Use when the user runs /aidw:status or asks about the state of the aidw workflow.
allowed-tools: Bash(aidw *)
---

# aidw: status

The `aidw` CLI ships with this plugin as `${CLAUDE_PLUGIN_ROOT}/bin/aidw`. If a command fails with
`aidw: command not found`, run that path instead of `aidw` (here and in every command below).

1. Run `aidw status` and `aidw validate`.
2. Report per change: state, approval (`none` / `valid` / `APPROVAL DRIFT`), task progress, paused reason.
3. Explain the next step for each state:
   - `draft` / `intake` / `analyzing`: continue the Analysis (`/aidw:start` steps).
   - `awaiting_approval`: the user reviews the gate page (`aidw page render gate` prints its link again when
     `/aidw:start` wrote one) or `analysis.md`, then `/aidw:approve` or asks for changes.
   - `approved` / `executing`: `/aidw:run` (for executing, also show `aidw next --change <id>`).
   - drift: the approved package changed. `aidw transition <id> escalated`, then `analyzing`, then re-approve.
   - `verifying` / `converging` / `deploying`: `/aidw:run` continues the loop (verify, converge, deploy).
   - `delivered`: `/aidw:deliver` (delivery package, then archive).
   - `paused` / `escalated`: `/aidw:resume` once the cause is gone (escalation reason from the task's
     `notes` and `.aidw/changes/<id>/evidence/<task>.json`). A task escalated by a triage with the cause `plan`,
     `spec` or `architecture` has a decision waiting: `aidw page triage <T>` prints the link of its Decision Page.
     (Only a Change from an older aidw: since ADR-0014 a Triage cause never escalates.)
   - tasks `not_built`: the run could not build them and carried on (ADR-0014): give each one's `not_built.reason`
     (an environment cause names what the user must fix; a plan, spec or architecture cause ran out of its three
     upstream rounds; the Agent-run cap). The pull request lists them.
4. Show validation errors verbatim; do not fix anything unless the user asks.
