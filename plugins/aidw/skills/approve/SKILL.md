---
name: approve
description: Approve the Analysis package of an aidw change and start the build where the CLI routes it (in the session, or the background runner). Only when the user runs /aidw:approve.
disable-model-invocation: true
argument-hint: "[change id]"
---

# aidw: approve the Analysis

The `aidw` CLI ships with this plugin as `${CLAUDE_PLUGIN_ROOT}/bin/aidw`. If a command fails with
`aidw: command not found`, run that path instead of `aidw` (here and in every command below).

The user has asked to approve. This is the single human gate of the workflow (Q2).

1. Run `aidw status`. Pick the change in `awaiting_approval` (or `$ARGUMENTS` if given). If none is waiting, say so
   and stop. The scope of a new product is not approved here: it is a round of the discovery interview (ADR-0011), so a
   change still in `analyzing` goes on with `/aidw:start`.
2. Run `aidw validate <id>` and `aidw analyze <id>`. If either fails, show the errors and stop: the package
   goes back to analysis (`aidw transition <id> analyzing`).
3. The user knows what they approve from the gate page of `/aidw:start` step 9. If they pasted its answer in this
   session and every section was agreed, say so in one line. Otherwise give its link again (`aidw page render gate`,
   when `.aidw/run/pages/gate.yaml` exists) plus a recap of at most six lines: goal, stack and its source, deploy
   strategy, permissions, number of tasks, and the grants (the gate page's "Grants for this Change": envelope and
   Agent-run cap; `aidw plugin-path company/permissions.md`, "Grants at the Approval Gate"). A section the user marked for a change is not approved: stop and go back to
   analysis. When `quality.yaml` grants `push`, ask the user explicitly, even if every section was agreed: "Push
   `<branch>` to `<remote>` (`<remote URL>`) and open its pull request against `<base>` without asking: keep or
   withdraw?" (the branch and URL are on the gate page). On "withdraw", remove `grants.push` from `quality.yaml` and
   run `aidw validate <id>` before approving.
4. Run `aidw approve <id>`. The aidw gate turns this into a permission prompt: the user confirms it there.
   If the user declines the prompt, do not retry.
5. Report the approval hash. Explain that from now on:
   - the grants in `quality.yaml` are approved with it: with `push`, pushing the Change Branch to the named remote
     and opening its pull request against the named base do not ask again; every other tier 3 action still does;
   - the approved package (intake, analysis, specs, design, constitution) is frozen; changing it needs
     `aidw transition <id> escalated`, then `analyzing`, then a new approval;
   - autonomous execution starts right away: one fresh implementer per task, checkpoint evidence, independent
     review, a commit per task; after an interruption, `/aidw:resume`.
6. **Build: follow the `NEXT:` line of `aidw approve`; do not ask the user to pick.** The CLI chose where the build runs
   from the number of tasks (more than 3 go to the runner; plan D2):
   - `NEXT: build here: ...`: follow `$(aidw plugin-path skills/run/SKILL.md)` for `<id>` now, from its step 0 (the
     user does not type `/aidw:run`).
   - `NEXT: start the runner: <command>`: run exactly that command with the Bash tool and the sandbox disabled
     (`dangerouslyDisableSandbox: true`): the runner starts Claude Code sessions, which need the network and the login
     that the sandbox withholds. The gate allows exactly this command from the main session of an approved change; any
     other form asks or is denied. It returns at once and loops in the background: one fresh session per task or wave
     (about half the tokens per task of an in-session run: trial-3A 0.82M, trial-3C 0.40M), auto permission mode so
     nothing asks after the gate (ADR-0014), no MCP servers, waits out usage limits, runs `aidw doctor` before the first
     session, and stops by itself when it needs the user. Tell the user in three lines how to follow it (`tail -f
     .aidw/run/runner.log`, `aidw run --status`) and stop it (`aidw run --stop`), then stop.
   - The runner did not start (the prompt was declined, a runner is already running, the sandbox blocked it): give the
     user the same command to type with `!` in front, in this window (the `!` runs it in their own shell), and stop.
   Concepts: user guide, "Task, phiên và worktree".
