# Trial: the rpi upgrades on a real Change (V5)

Task V5 of `docs/plans/rpi-upgrades-verify.md`, run 2026-11-27 on `feat/rpi-upgrades` after V1 to V3, before PR #4
merges (the owner's choice). Nothing was fixed during the trial; each line below is a finding for the next plan.

## Setup

- Project: a fresh copy of `aidw-trial-4` (meeting room booking: Next.js, SQLite through better-sqlite3, Vitest,
  Playwright; 7 capabilities archived) at `~/Desktop/Learning/aidw-trial-5`. `.env.example` restored from git.
- Plugin: `claude --plugin-dir ~/Desktop/Learning/product-development-workflow/plugins/aidw`, headless
  (`claude -p ... --permission-mode auto --output-format json`, then `--resume <session>` for each reply).
- Feature, as the user said it: "Nhân viên có thể sửa lịch đặt phòng của chính mình: đổi tiêu đề, hoặc dời sang giờ
  khác trong cùng ngày hoặc sang phòng khác. Admin sửa được mọi lịch. Áp dụng cùng quy tắc chồng lịch và giờ làm việc
  như khi đặt mới."
- The lead played the user (the owner asked for that), so the interview answers are the lead's (from turn 03 on, the
  V5 test agent, with the lead's product stance: small Change, recommended answers when they fit).
- Result: delivered and archived (`7d52d27 chore(aidw): archive 2026-11-27-edit-booking`), 5 tasks, 11 user turns,
  5 runner sessions, all quality layers pass; `aidw pr --create` refused cleanly (no remote).

Cost and turns per stage. `total_cost_usd` in the turn json is cumulative over the resumed session, so the stage
cost is the difference; `num_turns` and `duration_ms` only cover the last wake-up of a turn (see findings), so the
wall time is from file times. Runner sessions report no cost anywhere.

| Turn | Stage reached | Cost (cumulative) | Stage cost | num_turns |
|---|---|---|---|---|
| 01 | intake, workflow proposed | 0.55 | 0.55 | 7 |
| 02 | Existing System Report, discovery page 1 | 2.68 | 2.13 | 15 |
| 03 | discovery page 2 | 3.07 | 0.39 | 9 |
| 04 | requirements (PM), delta specs (BA), 2 chat questions | 5.39 | 2.32 | 1 |
| 05 | design page | 6.15 | 0.76 | 12 |
| 06 | architecture, system-design question in chat | 8.01 | 1.86 | 18 |
| 07 | contracts page | 8.33 | 0.32 | 7 |
| 08 | data model + API contract, trigger question | 10.02 | 1.69 | 3 |
| 09 | Program Design, plan, QA, doctor, e2e baseline, format question | 14.66 | 4.64 | 18 |
| 10 | gate page (plan review pass) | 16.10 | 1.44 | 23 |
| 11 | approve attempt blocked | 16.46 | 0.36 | 5 |
| runner | T01 2.5 min, T02 4.4, T03 5.3, T04 10.3 (2 attempts), T05 + layers + delivery 23.7 | n/a | n/a | 5 sessions |

## Findings

One line each: the Artifact or command, then what happened.

- `aidw detect` (start): warns "monorepo" because `pnpm-workspace.yaml` exists, though it holds only
  `allowBuilds: esbuild` and no `packages:`. The orchestrator explained it away to the user; the check should read the
  file before warning.
- Existing System Report (turn 02): worked as intended. 5 neutral questions about today's code in 2 groups
  (`existing-system/questions.md`), two parts written in parallel, one merge with a 10-line summary copied into
  `## Existing system`; no proposals in the parts. Only trace of the request: part 1 quotes a code comment
  ("an edit feature needs an UPDATE trigger") from `lib/db/schema.sql:38`, which is fair evidence.
- Discovery round 1 page (`discovery-1.yaml`): Q1 asks the user to pick the Size (small or normal) although the
  orchestrator already had the facts to settle it (DB trigger + API + UI, 3 to 5 tasks); the user can only accept.
  `aidw page answers` checked the pasted text cleanly.
- Discovery round 2 page, Q4 "two people edit at once" (`discovery-2.yaml`): asks the user to choose between
  last-save-wins and a version column; the option text talks about "dấu phiên bản trên mỗi lịch", a technical
  choice that belongs under `### Deferred to architecture`. The answer then became ADR 0003 written by the Product
  Manager, before the architecture stage.
- Orchestrator chat after round 2 (turn 04): while the PM and BA Agents ran, it asked two extra questions in chat
  (end-time list `keep|cut`, 403 when the booking starts while the form is open `like-404|close`). Both had a
  recommendation that simply copies the create form's existing behaviour; the orchestrator could have settled them and
  recorded them. In headless (`claude -p`) mode the first question was in an intermediate message, so only the
  final message reached the user and it said "the question above": a user reading the result alone misses it.
- Orchestrator chat (turn 05): an internal English note "Record in appendix and have BA add the 403-while-open case
  to the refusal requirement." was emitted as user-facing text in a Vietnamese session.
- Design page (`design.yaml`, turn 05): a full Decision Page round to ask "reuse the existing design system or design
  anew" for one dialog in an app whose design system came from the previous Change. Recommended answer was obvious;
  a one-line chat confirmation would do. `aidw page answers design` prints a useful `NEXT: aidw decide ...` line.
- System design round (turn 06): worked as D2/D3 intend. The Architect answered DA1-DA3 and settled DQ1-DQ11 with
  Chosen / Why (citing `existing-system.md` sections and file:line) / Rejected, left none open with a stated reason,
  and the orchestrator asked one question in chat with a summary, links and a diff View. Three DQs (2, 3, 9) are
  "assumed: nothing read settles it" and are flagged for the gate page. Before the reply, `aidw analyze` correctly
  still demanded `### System design round` and `program-design.md`.
- Contracts page (`contracts.yaml`, turn 07): after the round reported "no Design Question open", the user gets a
  further page asking whether a Database Architect Agent is needed and whether to write OpenAPI for `PATCH`. Both
  are technical calls with a clear recommendation (the trigger already sits in ADR 0004 and the API table in
  overview.md); they should be settled by the Architect (as DQs) or folded into the system-design question, not a
  separate user round. Its third option ("Server actions") is labelled by the page itself as not fitting the app.
  Also: the order is architecture → round → data/contract stages, so the Program Design is written later than the
  round it should follow directly (D3/I5), or the round confirms a design before its data model is designed.
- Data model (turn 08): the Database Architect reopened the Architect's settled DQ9 (date and Booker kept only by
  the UPDATE's column list) and the orchestrator put it to the user in chat as `add|skip` (a third trigger). It is a
  technical choice the Architect had already settled with reasons; the conflict between two Roles should go back to
  the Architect, not to the user. Confirms the previous line: the data stage runs after the user confirmed the design.
- Test browser (turn 07/08): the orchestrator asked the user to run `aidw browser start` in their own terminal
  (sandbox cannot launch Chrome), in the middle of the data/contract stage. Expected by `skills/start/SKILL.md:394`,
  but it is an interruption with no relation to the question on screen; it would fit the environment preflight at
  intake, or `aidw run` (which starts the browser itself). Run by the tester: started headless on a free port.
- Program Design (`program-design.md`, turn 09): good. File-tree diff with `~`/`+`, signatures as diffs against
  existing shapes, call trees, component tree, pseudocode of the refusal order; cites DQs and data-model lines.
- `tasks.yaml` (turn 09): every task has `patterns:` with path:lines and a why; T05 has one `manual:` VoiceOver
  check; no `docs:` and analysis says "No Docs Brief is needed (no library is new or version-sensitive)", which is
  right for this Change, so Docs Briefs and `.aidw/research/docs/` were not exercised.
- `aidw analyze` (plan): WARN "depends_on without overlapping touches: T03 on T01, T05 on T03, T05 on T04" is a
  false positive: T03's 409 tests need T01's trigger (stated in analysis `## Plan`) and T05's e2e tests need T03 and
  T04 built, dependencies on behaviour, not on shared files. The check has no way to accept a stated reason.
- `aidw analyze` (plan): WARN "T03 (28 of 83 scenarios) carry a third of the plan ... split" while the plan explains
  every booking scenario goes through one function `editBooking`; same: no way to record the reason.
- Format check (turn 09): asked in chat whether to fix README formatting (`fix|skip|exclude`); legitimate since the
  baseline already flagged it for the gate. Fine, but it came as a third chat interruption in the plan stage.
- Gate page (`gate.html`, turn 10): Before / After is the first section, as D1 says, but its lines are the English
  text of `analysis.md` inside a Vietnamese page; the CLI-generated sections (Program Design, Plan, Decision
  Points, Grants) are English too. The plan section shows each task's Patterns and "Checks for you 1".
  `aidw page answers gate` accepted the reply and printed the NEXT line (approve is the user's).
- Branch (turn 09): the Change builds on the previous Change's branch `aidw/2026-11-17-meeting-room-booking`
  because it was never merged to `master`; stated on the gate page. Reasonable, but the PR would carry both Changes.
- Gate page intro vs approval (turn 11): the page says "Khi mọi phần được đồng ý, việc build tự chạy", so after the
  all-ok reply the orchestrator ran `aidw approve` itself; the aidw hook blocked it ("approving the Analysis package
  is the user's decision") and it then told the user to type `/aidw:approve` or `! aidw approve`. The guard works;
  the page wording promises something the orchestrator may not do.
- `aidw approve` (tester, as the user): approved, 23 files hashed, NEXT gives the exact `aidw run --detach` line.
  `aidw run --detach` started without the confirmation the NEXT line announces ("the start asks the user to
  confirm") when run from a non-tty shell.
- Runner (`aidw run --detach`): one fresh session per task, strictly one after another: T03 and T04, planned as one
  parallel wave (`T01+T02 -> T03+T04 -> T05`), ran serially, so the plan's waves and the analyze warnings about
  parallelism had no effect on wall time.
- Briefs (`.aidw/run/briefs/.../T01.implement.md`): `## Patterns to Follow` inlines each `patterns:` entry with its
  real snippet, and `## Decisions to honor` is carried; as I3 intends.
- Build: no implementer consulted Research (`evidence/agent-runs.json` holds only implementer, reviewer and
  layer-reviewer runs), so the consultation path (Q-R1) was not exercised. Nothing in the Change called for it.
- `runner.log`: keeps only the last lines of each session's final message, so the T05/delivery session's summary
  starts mid-list ("There's no rate limit ..."); what the session said about layers and delivery is lost from the log.
- `pr-summary.md` (delivery): Why in one sentence, 3 notes (ADR 0003 risk, migration, open manual check), a tree View
  and a call tree, focus lines with file:line; as I8 intends.
- PR body (`.aidw/run/pr-<id>.md`): the generated sections come first and the summary's H1 title is dropped, so the
  body opens with "## Differs from the approved package: Nothing". The VoiceOver check appears three times (Needed
  from the user, Notes, and "T05 ... (done)" in the task list, where "done" reads as if the check were done).
  "Merge danger" says the base branch "is not merged into `main`"; the repository's branch is `master`.
- `handoff.md`: `## Checks for you` lists the T05 VoiceOver check as a tick box; as M4 intends.
- `aidw pr --create` (no remote): "aidw: no git remote named origin: add one (git remote add origin <url>) and run
  this again", exit before any push. The runner had already stopped with `needs_user` and the exact NEXT line.
- `aidw archive` (tester): archived, specs updated (41 → 67 requirements), committed `7d52d27`, "also committed with
  it: README.md" (the Documentation Role's README change was left uncommitted after the delivered commit).
- `aidw analyze` after delivery: same two WARN lines as at the gate, 0 errors. At no stage did it refuse a correct
  Artifact; every ERROR it raised before the gate was a real gap at that moment.
- Headless measurement: when the orchestrator ends a turn while background Agents run, `claude -p` returns only the
  final wake-up's result (turn 04: `num_turns` 1, `duration_ms` 6.5 s for a 15-minute turn), and earlier messages of
  that turn (a question) are only in the session transcript.

## Flow coverage

| Step of the new flow | Reached | Notes |
|---|---|---|
| Existing System Report (neutral questions, parallel Research, merge) | yes | 5 neutral questions, 2 parts in parallel, merge with summary; no checks run |
| Before / After | yes | 5 + 5 lines from the report and round 1; first gate section, but English in a vi page |
| System Design round | yes | nothing open: one chat question with summary and diff View; recorded word for word |
| Program Design | yes | file tree, signatures, call and component trees, pseudocode; a gate section |
| Docs Briefs in the plan stage | no | no new or version-sensitive library; analysis says so |
| `patterns:` / `docs:` / `manual:` in tasks.yaml | partly | `patterns:` on every task and inlined in briefs; one `manual:`; no `docs:` |
| Build, with a Research consultation if one came up | partly | 5 tasks built and reviewed; no consultation came up |
| `pr-summary.md` and "Checks for you" | yes | both present; PR body order and duplicates noted |
