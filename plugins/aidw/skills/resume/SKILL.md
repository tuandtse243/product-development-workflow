---
name: resume
description: Resume an aidw change after an interruption - killed session, quota or rate limit, or an escalation the user has resolved. Use when the user runs /aidw:resume.
allowed-tools: Bash(aidw *)
disable-model-invocation: true
argument-hint: "[change id]"
---

# aidw: resume

The `aidw` CLI ships with this plugin as `${CLAUDE_PLUGIN_ROOT}/bin/aidw`. If a command fails with
`aidw: command not found`, run that path instead of `aidw` (here and in every command below).

All progress lives in `.aidw/` and git, so resuming needs no memory of the previous session.

0. Under `AIDW_RUNNER=1` the runner already ran `aidw doctor` for this session: skip `aidw doctor` below, and go to `aidw next` (it reports the state too, so skip `aidw status` as well).
1. `aidw status` (one call; skip it when the prompt already names the change and its state is known). Pick the change (`$ARGUMENTS`, or the single active one) and report where it stands:
   state, paused reason, tasks done/total.
   A resumed run may be on another machine state (Chrome closed, login expired): run `aidw doctor <id>` and
   settle FAIL lines before continuing.
2. By state:
   - `paused`: `aidw transition <id> resume` (returns to the state it paused from).
   - `escalated`: show the user why (the escalation reason and the task's evidence) and ask what to do. When the task
     has a triage diagnosis whose cause is `plan`, `spec` or `architecture` (a Change escalated by an aidw from before
     ADR-0014, which no longer escalates them), ask with a Decision Page: `aidw page triage <T>
     --change <id> --lang <en|vi>` prints its link; give the user the link and two lines, and when they paste the answer
     check it with `aidw page answers triage-<t>` (the task id in lowercase) before acting on it:
     - the cause is resolved (they fixed it, or gave the missing decision): `aidw transition <id> executing`,
       then for each task that is `escalated`, `aidw task retry <T>` (fresh attempt budget). Only on the
       user's explicit go-ahead: retrying is their decision.
     - the scope must change: `aidw transition <id> analyzing`, revise, approve again.
   - `approved`, `executing`: nothing to do here.
   - drift or anything before approval: explain (`/aidw:status`) and stop.
3. Read `$(aidw plugin-path skills/run/SKILL.md)` and follow it from its step 1 to its last step. Do not try to invoke
   `/aidw:run` as a skill: it is not offered to the model (it is a command the user types), so its text only reaches
   you through this file (trial: five headless sessions, three of them stopped to ask for it). The file holds the
   whole loop, not only the tasks: verify, converge, deploy and delivery are its sections 3 to 5, so do not stop
   when `aidw next` says `complete`. A wave task keeps its worktree across sessions: its brief
   points the new implementer there. `aidw next` returns the interrupted task first
   (`implement <T> (interrupted)`): its brief tells the new implementer to continue from the work already in
   the working tree rather than start over. A Consultation in flight comes before it (`consult`, `step: answer` or
   `resume`): the run skill's *consult* step says what to run; the resume brief lets a fresh Agent of the asking Role
   continue.
4. Headless (`claude -p` from `aidw run`): never ask the user anything and never offer choices ("tell me which you
   want"): the next step is in the run skill, so do it. If a decision is really needed, escalate with the
   question and stop; the runner reports it.
