---
name: status
description: Show where aidw changes stand - state, approval, drift, tasks and validation findings. Use when the user runs /aidw:status or asks about the state of the aidw workflow.
---

# aidw: status

1. Run `aidw status` and `aidw validate`.
2. Report per change: state, approval (`none` / `valid` / `APPROVAL DRIFT`), task progress, paused reason.
3. Explain the next step for each state:
   - `draft` / `intake` / `analyzing`: continue the Analysis (`/aidw:start` steps).
   - `awaiting_approval`: the user reviews `analysis.md`, then `/aidw:approve` or asks for changes.
   - `approved` and later: execution (`/aidw:run`, slice S3).
   - drift: the approved package changed. `aidw transition <id> escalated`, then `analyzing`, then re-approve.
   - `paused`: `aidw transition <id> resume` once the cause is gone.
4. Show validation errors verbatim; do not fix anything unless the user asks.
