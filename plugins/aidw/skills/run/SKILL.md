---
name: run
description: Execute an approved aidw change autonomously - one fresh implementer subagent per task, machine-checked evidence, an independent reviewer, one commit per task. Use when the user runs /aidw:run.
allowed-tools: Bash(aidw *)
disable-model-invocation: true
argument-hint: "[change id]"
---

# aidw: run the approved task graph

The `aidw` CLI ships with this plugin as `${CLAUDE_PLUGIN_ROOT}/bin/aidw`. If a command fails with
`aidw: command not found`, run that path instead of `aidw` (here and in every command below).

You are the **orchestrator**. You run in the main session, write no product code, and keep your own context
thin: the work happens in fresh subagents, the state lives in `.aidw/` and git. A killed session therefore
loses nothing: `/aidw:resume` re-enters this loop.

This is Pocock's `implement-spec` pattern (task graph, frontier, a fresh subagent per ticket, communication
through context pointers) wrapped with aidw governance: approval gate, per-task evidence, independent review,
commit per task. Tasks whose `touches` do not overlap run as a **parallel wave**, each in its own git worktree
that aidw creates; everything else runs sequentially on the main checkout.

## Ground rules

- Every state change goes through the `aidw` CLI. Never hand-edit `tasks.yaml`, `change.yaml` or evidence.
- Do not read or write source code yourself, and do not paste code into subagent prompts. Pass the brief path.
- Keep subagent replies short; do not re-verify their work by reading code. `aidw checkpoint` and the reviewer
  are the verification.
- **Your context is the cost.** Every turn you take re-reads everything before it, so each avoidable command is
  expensive. Run only what this skill says, one command per step; never `cat` or `sed` a skill, profile or brief
  into the session (subagents read those themselves); never run `aidw status`/`aidw next` when the previous
  command already printed `NEXT:`.
- Reviewers write their verdict to a file and reply with one line; do not read the file. `aidw verdict` does.
- The aidw gate still applies: tier-3 actions (production deploy, pushing, paid resources) ask the user.
- Talk to the user in their language; keep status lines short (`T03 done (2/8)`).
- Spawn subagents with the prompt given below and nothing else: the brief already carries failures, review
  notes, decisions and design. If another plugin's hook rewrites the Agent input and auto mode asks you to
  resend it, resend that input once, verbatim, and mention once to the user that the plugin costs an extra
  call per subagent.

## 0. Enter execution

1. `aidw status`. Pick the change (`$ARGUMENTS`, or the single change that is `approved`/`executing`/`paused`).
   - `approved`: `aidw transition <id> executing`
   - `paused`: `aidw transition <id> resume`
   - `executing`: continue.
   - drift, `awaiting_approval` or earlier: stop and tell the user (`/aidw:status` explains what to do).
   - The transition puts HEAD on the change branch (`aidw/<id>`, or the feature branch the user was on) and
     prints where task commits go. If it says switching failed, stop and tell the user.
2. When the project is a git repository, check `git status`: unrelated uncommitted user changes would end up in
   task commits. If there are any, ask the user to commit or stash them first.
3. **Preflight (once per change, before the first task).** Run `aidw doctor <id>`. Greenfield tasks install
   packages and the last step deploys; both fail inside the sandbox in known ways (trial-3A lost over an hour):
   - FAIL: stop and tell the user what to fix (the line says how), then run it again.
   - `package install` FAIL: packages cannot be installed from here (a scanner, a proxy, the sandbox). No implementer can fix
     that. Give the user the line as it is, and do not spawn anything until `aidw doctor <id> --fresh` passes.
     Offer the shortest way out first: `aidw run <id> --detach` in the user's own terminal. The runner probes from the
     user's terminal, and its headless sessions run in auto mode, where a command the sandbox blocks can be run again
     outside it without waiting for a person (seen on real runs: in-session installs failed for hours with scanner
     timeouts, 502 and 407 from the sandbox proxy; the same scaffold installed in ten minutes under `aidw run`).
     The probe installs one tiny package, so it can pass while a large install (`next`) still times out:
     if an implementer's install fails after a passing probe, treat it as the same blocker and offer `aidw run`.
     Do not try other package managers, flags or settings changes to get around a scanner or proxy: those are the
     user's policy, not a bug to route around.
   - `pnpm store` WARN (not writable): ask the user to run the first `pnpm install` in their own terminal after
     T01's `package.json` exists, or to allow the path; do not let T01 sit waiting.
   - `chrome cdp` FAIL: no Chromium-family browser can start inside this session's sandbox (macOS denies it
     registering its processes), so the project's test browser has to be started outside it. Tell the user to run
     `! aidw browser start` once, or to use `aidw run`, which starts the browser itself because the runner is not
     sandboxed. Do not try to launch Chrome from here.
   - `vercel project` WARN (not linked): run `vercel link --yes` now (creating a free project is covered by the
     `vercel-preview` permission). Without it the first deploy is forced to Production, which is tier 3.
4. Not running under the runner (`echo $AIDW_RUNNER` is empty) and more than 3 tasks remain: **recommend the runner first**:
   tell the user once, in one line, that `aidw run <id> --detach --permission-mode auto` builds everything in the
   background, one fresh session per task, for about half the tokens of this long session, and that you can start it
   now (`/aidw:start` and `/aidw:approve` already start it by themselves after approval when the plan has more than 3
   tasks). On a yes, start it as step 6 of `$(aidw plugin-path skills/approve/SKILL.md)` says and stop; otherwise
   continue here.

## Token discipline (this session re-reads its whole context on every turn)

Trial-3A: 186 orchestrator turns re-read a context that grew from 51K to 300K tokens; that was 57% of the cost.

- Every aidw command prints a `NEXT:` or `SPAWN` line: follow it. Do not call `aidw next` or `aidw status` in between.
- After spawning subagents, end the turn with one short line (`Waiting for T03.`), never with no text: an empty
  turn makes Claude Code ask for a visible reply, which costs a whole extra turn (seen on a real run). Do not
  narrate waiting or restate what a result said.
- Run independent aidw commands in one Bash call (`aidw checkpoint T02; aidw checkpoint T03`), and spawn every
  ready subagent in one message. Do not Read files a brief already summarizes.
- A fix task of a layer that has its own reviewer is auto-reviewed: do not spawn a reviewer for it.
- With more than 3 tasks left, the cheapest path is `aidw run <id>` in the user's terminal (fresh session per task,
  no MCP servers). Say so once.

## 1. Loop

Repeat until `aidw next` says `complete` or `escalate`:

```
aidw next --change <id> --json
```

**`implement <T>`** (reason `new`, `retry` or `interrupted`):
1. `aidw task start <T> --change <id>`. It prints the brief path and the exact prompt to use. If it fails
   because attempts are exhausted (Triage comes next) or the Agent-run cap is reached, run `aidw next` and follow it.
2. Spawn the Agent named on the `SPAWN` line of `task start` (Agent tool, `subagent_type: "<that name>"`: `aidw:fullstack`,
   `aidw:frontend` or `aidw:backend`, from the task's `role`) with the printed
   prompt (`Task brief: <path>. Read it and implement the task.`). Wait for it.
3. If the implementer ends with `CONSULT <path>`, it lacks information and asks another Role: go to *consult*
   below. Never answer for that Role yourself and never take the question to the user.
   A `BLOCKED: documents disagree` reply (Expected / Found / Why this matters) is not an environment cause, and it is
   not retried: a retry brief drops the implementer's report note and Triage never sees the three lines. Open a
   Deviation for the Role that wrote the higher document, with the three lines as its reason:
   `aidw deviation open --change <id> --role <author> --files <that document> --task <T> --reason "<the three lines>"`
   (see **`deviation`**); then `aidw checkpoint <T>` for the attempt in flight. Closing the Deviation runs `<T>` again
   on the corrected document.
   If it reports a blocker no Role can answer (a credential, a service that is down), that is an environment cause
   (ADR-0014): `aidw not-built <T> --cause environment --reason "<its words>" --change <id>`. The task and its
   dependants are not built, the rest carries on, the pull request says what the user must provide; tell the user in
   one line and follow the printed `NEXT:`. A package install or build tool that fails for a reason outside the code
   (the network, a package scanner that times out, a sandbox denial) is such a blocker too: mark it the same way with
   the exact error. Never spawn an implementer to find out whether the environment was fixed (two minutes and its
   tokens each time): run `aidw doctor <id> --fresh` (ten seconds). `aidw transition <id> executing` also refuses to
   resume while its `package install` check fails, and prints what the user must change.
4. `aidw checkpoint <T> --change <id>`. Read its last lines:
   - FAIL: the task is marked failed with the reason. It prints `NEXT: implement <T> (retry)`; loop (the retry
     brief carries the failure and the debugging skill).
   - BLOCKED (environment): a check failed because the machine refused it (the sandbox denied a file lock, a proxy
     answered 407 or 502, a package scanner timed out), not because of the code. The task stays running and no
     attempt is used. Run the same `aidw checkpoint` once more outside the sandbox (`dangerouslyDisableSandbox: true`;
     auto mode allows it, an interactive session asks the user). Refused a second time, the CLI marks the task not built
     (`NOT BUILT (environment)`, the refused command in the reason) and prints `NEXT:`; follow it. Never start a new
     attempt or spawn the implementer again for it.
   - PASS with `auto-passed`: a converge task that only added tests; it is reviewed and committed already.
     Follow the printed `NEXT:`.
   - PASS with `SPAWN aidw:code-reviewer`: go to the review step below.

**`review <T>`**:
1. The checkpoint printed the review brief and prompt (if you only have `NEXT: review <T>`, run
   `aidw brief <T> --change <id> --for review`). Spawn the `aidw:code-reviewer` subagent with
   `Review brief: <path>. Review the task and reply with the verdict.`
2. The reviewer writes its verdict to `.aidw/run/review-<T>.md` and replies with its first line. Run
   `aidw verdict <T> --change <id>`: it reads that file, records `pass` (marks done, commits the task, keeps the
   reviewer's non-blocking remarks for the handoff) or `fix` (the retry brief carries the notes), and prints
   `NEXT:`.
   - It fails with "no verdict file" or "does not start with VERDICT": spawn a fresh reviewer once more; if
     still unclear, save its reply to that file yourself and, as a last resort,
     `aidw review <T> fix --notes-file <file> --change <id>`.
3. Report one line to the user: `T03 done (3/8)` or `T03 needs fixes (attempt 2/3)`.
4. **`END THIS SESSION`** in the output (only under `aidw run`): reply with one line and stop, calling no more
   tools. The runner starts a fresh session for the next task. Do not continue the loop.

**`wave <T1>, <T2>, ...`** (tasks that can run side by side):
1. For each task: `aidw task start <T> --worktree --change <id>`. If one fails because its worktree setup
   failed, it is marked sequential and runs later on its own; continue with the others.
2. Each `task start` printed the brief path and prompt.
3. Spawn one Agent per task, the one named on its `SPAWN` line, **in a single message** (parallel Agent calls), each with only its
   printed prompt (`Task brief: <path>. Read it and implement the task.`). Wait for all of them.
4. An implementer that ends with `CONSULT <path>`: handle it as *consult* below while the others go on (spawn the
   consulted Role as soon as the request comes in; do not wait for the rest of the wave). A blocker no Role can
   answer: `aidw not-built <T> --cause environment --reason "<its words>"` (as in *implement*, step 3); the others go on.
5. `aidw checkpoint <T>` for each task, one after the other (checkpoints run builds; never in parallel).
6. Each passing checkpoint printed its review prompt. Spawn the reviewers of all passing tasks in one message,
   then `aidw verdict <T>` for each, one after the other.
   `aidw review <T> pass` merges the task's worktree into the change branch and commits it. If the merge
   conflicts, the output says so (say so to the user in one line); record the remaining verdicts first: `resolve <T>`
   (below) comes up in `NEXT:` after the wave's other reviews.

**`resolve <T>`** (a wave task's merge conflicted with a task already merged; its work is kept):
1. `aidw brief <T> --for conflict --change <id>`. It merges the change branch into the task's worktree and prints the
   brief path and the `SPAWN aidw:integration` line.
2. Spawn `aidw:integration` with the printed prompt (`Conflict brief: <path>. Read it and resolve the conflict.`) and
   nothing else. Wait for it.
3. `aidw resolve <T> --change <id>`: it checks the resolution, commits the merge in the worktree and runs the
   checkpoint's guards and both tasks' checks again. `BLOCKED (environment)`: run it once more outside the sandbox, as for
   a blocked checkpoint; nothing was dropped. `RESOLVED`: it printed the merge review brief and `SPAWN aidw:code-reviewer`; spawn it with the printed
   prompt, then `aidw verdict <T> --change <id>` (pass merges the task). `DROPPED`: the task reruns sequentially later;
   follow the printed `NEXT:`.
If only `NEXT: review the merge of <T>` is left (a new session), run `aidw brief <T> --for merge-review --change <id>` and
continue at the reviewer. A `fix` verdict on the merge drops the task too: no retry of the integration Role.

**`integrate <T1>, <T2>, ...`** (a wave was merged): `aidw integrate --change <id>`. It runs the wave's verify
commands and the `code` layer on the merged code.
- `PASS`: loop.
- `FAIL` with a fix task `Inn`: loop; `next` returns it before anything else (it runs on the main checkout).
- `NOT BUILT`: its fix rounds are exhausted (or the Agent-run cap is reached). The wave stays merged and the quality
  layers judge it; the pull request lists it. Follow the printed `NEXT:`. Nobody is asked (ADR-0014).

**After the Approval Gate the run never asks the user** (ADR-0014). What cannot be built is marked **not built**
(status `not_built`, with `not_built: { cause, reason }` in tasks.yaml), so is every task that depends on it, and the rest carries
on; the pull request lists it. Only what is never automatic (credentials outside the project's `.env`, anything that
costs money, production deploys, deleting cloud data) still goes to the user, through the gate's own question.

**`triage <T>`** (the task used all its attempts): an independent diagnosis decides what follows.
1. `aidw brief <T> --for triage --change <id>`. It prints the brief path and the `SPAWN` line.
2. Spawn the Agent named there (`aidw:software-architect`) with the printed prompt and nothing else. It reads the
   evidence of every attempt and writes `.aidw/run/triage-<T>.md` (first line `CAUSE: ...`).
3. `aidw triage <T> --change <id>` records it and applies the rule of the cause; follow the printed `NEXT:`:
   - `implementation`: one further attempt with the diagnosis in its brief. If that fails too, the task is not built.
   - `plan`, `spec`, `architecture`: an upstream round (below): the Role that wrote that Artifact fixes it and the task
     runs again, at most 3 rounds; after that the task is not built.
   - `environment`: not built at once (a key, the network: nothing inside fixes it). The output names what the user
     must fix to finish it later; tell the user in one line and carry on.
4. No clear `CAUSE:` line: spawn it once more; still unclear, `aidw triage <T> --unclear --change <id>`: the task is
   not built (cause triage) and the run carries on. Never write a cause yourself.

**`upstream <T>`** (Triage found the cause in the plan, the spec or the architecture; round N of 3):
1. `aidw brief <T> --for upstream --change <id>`. It opens the round's Deviation for the files at fault (the
   Artifact of the cause, or the files Triage named; the gate then lets only the author change them), writes the
   author's one brief and prints the `SPAWN` line of the author Role (`aidw:technical-planner` for the plan, the owner
   in artifacts.yaml of the specs, the architecture or the named file for the others) and what to run after. Do not
   open a Deviation yourself, and do not spawn the Deviation's author a second time: `aidw next` says `upstream ...
   Deviation Dnn is open` while the author works.
2. Spawn the author with the printed prompt and nothing else. It changes its Artifact (keep the purpose, smallest
   change, no new scope) and replies `FIXED: ...` or `CANNOT FIX: <why>`.
4. `FIXED`: `aidw deviation close --change <id>` (the CLI checks the change and records the Deviation), then
   `aidw upstream <T> --change <id>`: the task runs again with a fresh attempt budget (`NEXT: implement <T>
   (retry)`); it is refused while the Deviation is open, and after one that was abandoned. `CANNOT FIX`, or a close
   the CLI refuses and the author cannot put right: `aidw upstream <T> --cannot "<its reason>" --change <id>`: the
   Deviation is abandoned (the files go back as approved) and the task and its dependants are not built. Never fix
   the Artifact yourself and never ask the user.

**`consult`** (an Agent asked another Role, ADR-0013; `next` returns it first, `step` says which part is left, and
`meanwhile` is what the rest of the Change does at the same time: the tasks that wait for an answer are left out of it).
Do the step **and** the `meanwhile` action in one message (parallel calls), so the rest of the wave carries on. No
`meanwhile` means nothing may run beside the asker (its work sits on the main checkout, or no slot is free): do only the step.
The Agent wrote a request file and ended its turn with `CONSULT <path>`:
1. `aidw consult <path> --change <id>`. It checks the request (the pair its Role declares, one level deep, at most 2 per
   Agent run, in the build only the authors of the contracts the task reads, one open question per run) and prints the
   brief and the `SPAWN` line of the consulted Role. Refused: the asker goes on without the answer. Spawn a fresh
   implementer with `aidw brief <T> --change <id>` and the refusal line in its prompt. Never answer in its place.
2. Spawn the Agent named on the `SPAWN` line with the printed prompt and nothing else (`step: answer`). It writes
   `.aidw/changes/<id>/consult/C<NN>.answer.md` and replies with its `STATUS:` line.
3. `aidw consult answer C<NN> --change <id>` (`step: record`: the answer is on disk, do not spawn again). It records the
   answer and always writes a resume brief (original brief, progress note, answer path). `ROUTE: ... Deviation`: after
   the gate the answer could not be given without changing something approved; nobody asks the user (ADR-0014). `next`
   now says `step: deviation`: read the answer and open a Deviation for the Role that wrote the approved file
   (`aidw deviation open --role <author> --files <approved files> --reason "<why>" --consultation C<NN>`, see
   **`deviation`**); resume the asker only after it is closed. If nothing approved has to change after all, resume it
   straight away.
4. `aidw consult resume C<NN> --change <id>` (`step: resume`) prints both ways on. If the Agent that asked is still
   running in this session (you can still reach it), continue it with SendMessage and the printed line: cheaper, it
   keeps its context. Otherwise (a new session, the runner, the Agent is gone) spawn the Agent on the `SPAWN` line with
   the resume brief. Then go on as after any implementer: `aidw checkpoint <T>`.
An implementer whose reply names a Consultation that was routed to a Deviation (`needs-deviation`) is not a blocker:
checkpoint it as usual; the gap is on record and the pull request will show it. It is never an escalation.

**`deviation`** (something approved must change after the gate, ADR-0014; `next` returns it while one is open, with
`meanwhile` for work already in flight). The Role that wrote the file decides; you never edit it and never ask the user.
1. Open it, once: `aidw deviation open --change <id> --role <author> --files <a,b> --reason "<why>"` (add
   `--consultation C<NN>` when a Consultation routed here, `--task <T>` for the task that needs it). The CLI refuses a
   Role that did not write a file (artifacts.yaml) and a file outside the approved package. Several Roles only when one
   change spans their files (a scenario renamed in the delta spec and in tasks.yaml: business-analyst and
   technical-planner). It prints the brief (the three rules: keep the purpose, smallest change, no new scope) and one
   `SPAWN` line per Role.
2. Spawn each Agent on a `SPAWN` line with the printed prompt and nothing else. While it is open the hook lets each file be
   edited by its author Role only, never you (by Bash neither); an edit anywhere else in the package is still drift.
3. When they reply: `aidw deviation close --change <id> --summary "<their one paragraph>"`. Refused, it says why
   (another approved file drifted, a contract or scenario is half written, the grants, permissions or layer commands changed, the
   package does not validate, an approved scenario is removed without a reason, a new requirement, a new task serves no
   approved scenario): send the author back with that line. When the author removed an approved scenario and said why,
   add `--remove-reason "<scenario>=<its reason>; ..."`; when it says a new requirement is not new scope and why, add
   `--scope-reason "<why>"`. "Task still in flight": finish that task's step (`meanwhile`), then close again. Closed,
   it prints the contract classification (additive, breaking, prose or unclassified), the tasks that run again (done
   ones are back to pending) and, for a Consultation, the `aidw consult resume` to run.
4. Nothing needs to change after all, or the author cannot meet the rules: `aidw deviation abandon --change <id>` puts
   the files back.

**Not built** (D10): an implementer that reports work outside what the user granted (the permission envelope in the
brief, or anything never automatic: credentials outside `.env`, anything that costs money, production deploys, deleting
cloud data) is not retried and not escalated: `aidw not-built <T> --change <id> --reason "<what it needs>"`
(`--cause environment` for a missing key or the network). The task
and the tasks that depend on it are marked `not_built`; the rest carries on and the pull request lists them.

**`escalate`**: see below.

**`complete`**: every task is done or not built (the line lists those not built). Go to section 3 (verify): the
Change moves on with them listed; never stop for them.

**The Agent-run cap** (set at the gate, `grants.agent_runs` in quality.yaml; by default 3 times the planned Agent
runs: an implementer and a reviewer per planned task, and a reviewer per review layer; fixed in the approval record
when the user approves): the CLI counts every Agent it prints a `SPAWN` line for. At the cap no new task starts:
`aidw next` (and every command that changes state) abandons an open upstream Deviation and marks every task that has
not started, or failed, not built with the cap as the reason, while work already running (an implementer, a review, a
merge conflict, a Consultation already answered) finishes. No new Consultation is recorded: the asker builds what
was approved and reports the gap. A failing layer, an integration or a converge gap gets no fix task either. Review
layers still run their reviewers at the cap: they judge what was built and add nothing. The run goes on to verify
and delivery and ends cleanly. Tasks that can never run (no runnable task, nothing in flight) are marked not built
too, so the run never stops on them.

## 2. Escalate

After the gate only for three things: an action that is never automatic (D14: credentials outside the project's
`.env`, anything that costs money, a production deploy, deleting cloud data), where the gate asks the user at the
moment of the action (a task that cannot go on without it while nobody answers is not built, as above); a stop the
user makes; and an `escalate` the CLI itself prints (a task the user escalated by hand). A Triage cause, a blocker no Role can answer, a
check the machine refused twice, a layer out of fix rounds, a converge gap and the Agent-run cap never escalate: they
are not built (ADR-0014).

1. `aidw transition <id> escalated --reason "<short reason>"`.
2. Tell the user what is blocked and why (task, attempts, the last checkpoint failure or review notes from
   `.aidw/changes/<id>/evidence/<T>.json`), and the options:
   - fix the cause yourself, then `/aidw:resume`;
   - change scope: `aidw transition <id> analyzing`, revise the Analysis, approve again.
3. Stop.

## 3. Verify (quality layers)

1. `aidw transition <id> verifying` (refused while any task is neither done nor not built).
2. `aidw verify --change <id>`. It runs the layers of the approved `quality.yaml` in order (code, unit,
   integration, e2e, ui-ux, a11y, security, performance, ...), skipping layers that already passed on the
   current code.
   - `PASS`: go to section 4.
   - A layer failed and a **fix task** `Qnn` was added: the change is back in `executing`. Return to the loop
     (section 1): the fix task runs through implement, checkpoint and review like any other, then come back here.
   - `REVIEW`: one or more **review layers** (`review: ui`, `review: security` or `review: performance`) passed their commands and
     wait for independent reviewers. The output names, for each, the agent, the brief and the prompt; with two or more it
     names the layer too and ends with a `NEXT:` line (the CLI already left out a second browser user and anything past
     `parallel.max`; the rest come in the next round):
     1. Spawn each named agent (`subagent_type: "aidw:ui-ux-designer"`, `"aidw:security"` or `"aidw:performance"`, as the command names it), **all in
        one message** (parallel Agent calls, one per layer), each with exactly its printed prompt:
        `Layer review brief: <path>. Review the layer and reply with the verdict.`
     2. Each reviewer writes its verdict to `.aidw/run/layer-review-<layer>.md` and replies with one line. For each, as it
        returns, run `aidw layer-review <layer> --change <id>` (no verdict argument): it reads that file and records
        `pass` or `fix`, keeping the non-blocking remarks for the quality report and the handoff. No clear
        verdict: spawn a fresh reviewer once more; still unclear, record `fix` with
        `aidw layer-review <layer> fix --notes-file <file>`.
     3. Record every verdict of the group first, also after one of them was `fix`: the `pass` verdicts first, then the `fix`
        ones. All `pass` -> run `aidw verify` again for the remaining layers. A `fix` -> a fix task `Qnn` was added
        with the reviewer's notes; return to the loop (section 1), then come back here. A `fix` whose fix rounds are
        exhausted (or at the Agent-run cap) -> that layer is marked **not built**: record the group's other verdicts
        all the same, then carry on (`aidw verify` again, or the loop when another verdict added a fix task). Nobody
        is told to decide; the pull request is a draft that lists the layer.
   - A layer that failed past its fix rounds (or at the cap) is marked not built and verify goes on with the next
     layers in the same call (`NOT BUILT <layer>` in the output). Carry on as the result says.
3. Do not edit quality.yaml, skip a layer or weaken a test to get green: the package is frozen and the gate
   denies it. A layer that cannot pass for a reason outside the code (missing Docker, missing login) runs out of fix
   rounds and is marked not built; say in one line what the user must provide to finish it.

## 4. Converge

1. `aidw transition <id> converging` (refused unless every layer passed on the current code).
2. `aidw converge --change <id>`: every scenario this change adds or modifies must have a passing test
   (from the layers' JUnit reports when configured, otherwise a non-skipped test naming the scenario id).
   - `PASS`: go to section 5.
   - `GAPS` with converge tasks `Cnn` added: the change is back in `executing`. Return to the loop (section 1);
     after the tasks, verify (section 3) and converge again.
   - `PASS` with `not built:` scenarios: their task was not built, their converge task did not close the gap, or the
     Agent-run cap was reached. Nobody is asked: go to section 5; the pull request lists them.

## 5. Deploy, deliver, pull request

1. `aidw transition <id> deploying` (refused without a passing converge on the current code), then
   `aidw deploy --change <id>`.
   - target `preview`: runs the approved deploy command and the smoke checks; prints the URL.
   - target `none` / `local`: records that nothing was deployed.
   - `DEPLOY FAILED`: do not wait and do not retry with other commands (anything beyond the approved command needs
     the user, and a production deploy is never automatic, D14). Go on: the pull request opens as a draft and lists
     the deploy, with the error and its hint (e.g. "the user runs `vercel login` in their own terminal"), under
     "Needed from the user to finish"; `/aidw:resume` deploys again once the user fixed it.
2. `aidw transition <id> delivered` (refused only when `aidw deploy` never ran; commits `.aidw/`).
3. Follow `$(aidw plugin-path skills/deliver/SKILL.md)`: delivery package, screenshots, check, then the pull request
   (`aidw pr <id>`, then `aidw pr <id> --create` as its `NEXT:` says) **before** the archive, and the archive only when
   the pull request is ready. The run always ends in a pull request (D12): ready when everything passed, a draft when
   something was not built or the deploy failed. A draft is not archived: the Change stays `delivered` and
   `/aidw:resume <id>` finishes it.
4. Final report to the user: the pull request (link, ready or draft; or its body and the `NEXT:` line when the push was
   not granted), tasks and commits, quality layers and fix rounds, converge result, the preview URL, known issues,
   and where the delivery package is.

## Unattended runs (usage limits)

If the user wants the run to survive usage or rate limits without them, the runner does it. The main session of an
approved change may start it in the background, with the sandbox disabled. Use the exact command `aidw approve` printed
(`<plugin>/bin/aidw run <id> --detach --permission-mode auto`, plus `-- --plugin-dir <plugin>` when aidw is loaded from a
folder): the gate allows only that string, and only for an installed plugin; the runner start asks the user when aidw is
loaded from a folder, and a foreground `aidw run` inside a session is denied.

The user can also run it in their own terminal, without `--detach`.

Before every session the runner prepares what a sandboxed session cannot do: it starts the project's test browser
(`aidw browser start`, a free port, one profile per project) when a layer drives a browser, and stops it when the
change is archived. The sessions then connect to it over localhost. It loops `claude -p "/aidw:resume <id>"` until the change is archived, **one task per session** (a fresh session
starts at about 55K tokens instead of carrying hundreds of thousands), waits out each limit (the reset time from
the error, or 5 to 60 minutes of backoff), and stops on escalation or when two sessions make no progress
(log: `.aidw/run/runner.log`). Tier-3 questions cannot be answered headless; they end in an escalation. The run ends
at the pull request: archived after a ready one, or `draft` (the runner stops and prints the link, or the body and the
`NEXT:` when the push was not granted; `needs_user` with the `NEXT:` for a ready Change whose pull request the user
must open). Started again on a draft, the runner resumes it first. A machine check that fails right before a deploy
does not stop it: the runner records the deploy as failed with the check's words (the command is not run), delivers
the Change, and the pull request is a draft that lists the deploy.

## Long-running commands

`aidw checkpoint`, `aidw verify`, `aidw deploy` (and Playwright screenshots) run builds and test suites. Call them with the Bash tool's
maximum timeout (600000 ms). If one may take longer, run it in the background and wait for its completion
notification instead of polling. A verify killed half-way loses nothing: the next call skips layers that
already passed.
