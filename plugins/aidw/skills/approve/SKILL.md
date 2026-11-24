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

1. Run `aidw status`. Pick the change in `awaiting_approval` or `awaiting_scope_approval` (or `$ARGUMENTS` if
   given). If none is waiting, say so and stop.

   **`awaiting_scope_approval`** (Approval Gate 1 of a new product): the user has seen the scope gate page; name
   `.aidw/changes/<id>/brief.md` in one line (render the page now with `aidw page render scope-gate` only if
   `.aidw/run/pages/scope-gate.yaml` exists and they have not seen it), then run `aidw approve <id>` (the gate turns it into a permission prompt; do not
   retry if declined). It records the scope approval and the change goes back to `analyzing`: tell the user to say "continue"
   and carry on with `/aidw:start` step 3 (domain model, requirements and specs). Do not do steps 2 to 5 below: they are for
   the final approval.
2. Run `aidw validate <id>` and `aidw analyze <id>`. If either fails, show the errors and stop: the package
   goes back to analysis (`aidw transition <id> analyzing`).
3. The user knows what they approve from the gate page of `/aidw:start` step 9. If they pasted its answer in this
   session and every section was agreed, say so in one line. Otherwise give its link again (`aidw page render gate`,
   when `.aidw/run/pages/gate.yaml` exists) plus a recap of at most six lines: goal, stack and its source, deploy
   strategy, permissions, number of tasks, and the grants (the gate page's "Grants for this Change": push remote and
   base, envelope, Agent-run cap; `aidw plugin-path company/permissions.md`, "Grants at the Approval Gate"). A section the user marked for a change is not approved: stop and go back to
   analysis.
4. Run `aidw approve <id>`. The aidw gate turns this into a permission prompt: the user confirms it there.
   If the user declines the prompt, do not retry.
5. Report the approval hash. Explain that from now on:
   - the grants in `quality.yaml` are approved with it: with `push`, pushing the Change Branch to the named remote
     and opening its pull request against the named base do not ask again; every other tier 3 action still does;
   - the approved package (intake, analysis, specs, design, constitution) is frozen; changing it needs
     `aidw transition <id> escalated`, then `analyzing`, then a new approval;
   - autonomous execution starts with `/aidw:run` (one fresh implementer per task, checkpoint evidence,
     independent review, a commit per task); after an interruption, `/aidw:resume`;
   - **how to build, two ways; offer both in a few lines and let the user pick.** An agent cannot open another
     terminal tab or start `aidw run` itself (the sandbox blocks a nested Claude Code from the network and the
     login, and the gate denies it), so the cheap way is one line the user types in this same window:
     - **A. Background run (measured: about half the tokens per task of an in-session run)**: `! aidw run <id> --detach --permission-mode auto`
       (the `!` runs it in the user's own shell; the CLI prints the full path; if `aidw` is not on PATH, use the
       plugin's `bin/aidw` path). It returns at once and loops in the background: one fresh session per task or
       wave, no MCP servers, waits out usage limits, stops by itself when it needs the user (escalation, a failed
       `aidw doctor`). Follow: `tail -f .aidw/run/runner.log`, `aidw run --status`, `aidw run --stop`. Run
       `aidw doctor <id>` first.
     - **B. In this session**: the user says "go" and you start `/aidw:run`: subagents work automatically, but this
       session's long context is re-read on every turn (trial-3A in session: 0.82M tokens per task; trial-3C with the runner: 0.40M). Tell the user to
       `/clear` first if they can, since a fresh session starts leaner.
     Concepts: user guide, "Task, phiên và worktree". Do not start either yourself until the user picks.
