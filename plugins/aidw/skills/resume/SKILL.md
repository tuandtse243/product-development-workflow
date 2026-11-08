---
name: resume
description: Resume an aidw change after an interruption - killed session, quota or rate limit, or an escalation the user has resolved. Use when the user runs /aidw:resume.
disable-model-invocation: true
argument-hint: "[change id]"
---

# aidw: resume

The `aidw` CLI ships with this plugin as `${CLAUDE_PLUGIN_ROOT}/bin/aidw`. If a command fails with
`aidw: command not found`, run that path instead of `aidw` (here and in every command below).

All progress lives in `.aidw/` and git, so resuming needs no memory of the previous session.

1. `aidw status`. Pick the change (`$ARGUMENTS`, or the single active one) and report where it stands:
   state, paused reason, tasks done/total.
2. By state:
   - `paused`: `aidw transition <id> resume` (returns to the state it paused from).
   - `escalated`: show the user why (the escalation reason and the task's evidence) and ask what to do:
     - the cause is resolved (they fixed it, or gave the missing decision): `aidw transition <id> executing`,
       then for each task that is `escalated`, `aidw task retry <T>` (fresh attempt budget). Only on the
       user's explicit go-ahead: retrying is their decision.
     - the scope must change: `aidw transition <id> analyzing`, revise, approve again.
   - `approved`, `executing`: nothing to do here.
   - drift or anything before approval: explain (`/aidw:status`) and stop.
3. Continue with the `/aidw:run` loop from step 1. `aidw next` returns the interrupted task first
   (`implement <T> (interrupted)`): its brief tells the new implementer to continue from the work already in
   the working tree rather than start over.
