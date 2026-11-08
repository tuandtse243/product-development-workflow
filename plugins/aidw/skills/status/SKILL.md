---
name: status
description: Show where aidw changes stand - state, approval, drift, tasks and validation findings. Use when the user runs /aidw:status or asks about the state of the aidw workflow.
---

# aidw: status

The `aidw` CLI ships with this plugin as `${CLAUDE_PLUGIN_ROOT}/bin/aidw`. If a command fails with
`aidw: command not found`, run that path instead of `aidw` (here and in every command below).

1. Run `aidw status` and `aidw validate`.
2. Report per change: state, approval (`none` / `valid` / `APPROVAL DRIFT`), task progress, paused reason.
3. Explain the next step for each state:
   - `draft` / `intake` / `analyzing`: continue the Analysis (`/aidw:start` steps).
   - `awaiting_approval`: the user reviews `analysis.md`, then `/aidw:approve` or asks for changes.
   - `approved` / `executing`: `/aidw:run` (for executing, also show `aidw next --change <id>`).
   - drift: the approved package changed. `aidw transition <id> escalated`, then `analyzing`, then re-approve.
   - `verifying` / `converging` / `deploying`: `/aidw:run` continues the loop (verify, converge, deploy).
   - `delivered`: `/aidw:deliver` (delivery package, then archive).
   - `paused` / `escalated`: `/aidw:resume` once the cause is gone (escalation reason from the task's
     `notes` and `.aidw/changes/<id>/evidence/<task>.json`).
4. Show validation errors verbatim; do not fix anything unless the user asks.
