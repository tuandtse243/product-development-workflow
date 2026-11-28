# Plan: fix what the V5 trial found (findings 1 to 3)

Written 2026-11-27 from `docs/plans/rpi-upgrades-trial.md`, the trial of the rpi upgrades on a real Change
(`aidw-trial-5`, "edit a booking"). The owner chose findings 1 to 3 for this plan; the other trial lines are listed in
section 5 as a backlog. Base branch: `feat/rpi-upgrades` (PR #4, not merged yet).

## 1. Read first

1. `docs/plans/rpi-upgrades-trial.md`: Findings and Flow coverage.
2. `plugins/aidw/skills/start/SKILL.md`: Ground rules (l.21), 1c/2 Discovery (l.172), 5 Design decision (l.250),
   6 Architecture and the system design round (l.276), 6b Data model and API contract (l.321), 9 Analyze and present
   (l.410, the gate intro at l.459), 10 Approve (l.464).
3. `plugins/aidw/roles/software-architect/role.md` (Design Questions rules), `roles/product-manager/role.md` and its
   `discovery-frame` skill, `roles/database-architect/role.md`, `roles/api-designer/role.md`.
4. `src/stages.ts` (stage order and `aidw stages --done` checks), `src/gate.ts:413` (the approve guard, an `ask`),
   `src/parallel.ts:45` (`mustRunAlone`), `src/planreview.ts`.

## 2. What the trial showed, checked against the code

1. **The user is asked technical questions the Roles should settle.** Five times in one Change:
   - the Size in discovery round 1;
   - a "version column" option in discovery round 2;
   - two chat questions whose recommendation only copied the create form's behaviour;
   - the contracts page (Database Architect? OpenAPI?) after the Architect left no Design Question open;
   - the Database Architect reopening the Architect's settled DQ9 as an `add|skip` question.

   Cause in the skill: step 6b makes `data-model-needed` and `api-contract-needed` a user Decision Page, and step 3's
   "handle open decisions" sends any Agent's open decision to the user, with no rule that a later Role's objection
   goes back to the Architect first.
2. **Stage order.** 6b (data model, API contract) runs after the system design round, so the user confirms a design
   whose data model is not designed yet, and Program Design is written two stages after the round it follows.
   **Not a defect:** the build ran one task per session because T01 and T03 are `risk: high`, and
   `mustRunAlone` (`src/parallel.ts:45`) runs a high-risk task alone. The planned waves T01+T02 and T03+T04 could not
   happen, but nothing told the user so.
3. **Gate page wording.** The intro says the build starts by itself once every section is agreed (`SKILL.md:459`).
   Interactive, that holds: step 10 runs `aidw approve` and the gate turns it into a permission prompt
   (`src/gate.ts:413`, `ask`). Headless (`claude -p`), an `ask` cannot be shown, so it was blocked. Also, on a
   Vietnamese page, Before / After (copied from `analysis.md`, written in English) and the CLI-made sections
   (Program Design, Plan, Decision Points, Grants) were in English.

## 3. Decisions

- **D1. The Architect settles what is technical; the user sees it at the gate.** Questions to the user are about what
  the user wants or sees. A technical choice is a Design Question: the Architect settles it (`Chosen` / `Why` /
  `Rejected`) or leaves it `Open` under its existing rule (hard to reverse, options about equal, a change in cost or
  operation).
- **D2. A Role that disagrees with a settled DQ sends it back to the Architect,** never straight to the user. The
  orchestrator spawns `aidw:software-architect` with the objection. The Architect keeps or changes the DQ, and only
  an `Open` result reaches the user.
- **D3. The orchestrator settles a question whose recommendation copies existing behaviour.** It records it as an
  assumption with the file:line it copies (shown at the gate) instead of asking.
- **D4. Order: architecture draft → data model and API contract → system design round → Program Design.** The round
  confirms the whole design, and Program Design directly follows it.
- **D5. Keep `mustRunAlone` for high-risk tasks.** The plan review says when a planned wave will run serially, and
  why.
- **D6. The gate intro says what really happens,** and every text on a page is in the page's `lang`.

## 4. Tasks

Each task: one worktree under `.worktrees/`, test-first where code changes, a review agent, merge into the base
branch with the full suite. Run the eval cases named below (`aidw eval <role> --case <c> --runs 3`) before and after
a Role change.

| Task | What | Files | Done when |
|---|---|---|---|
| F1 | Discovery asks only product questions. The Size is set by the orchestrator, with its reason in the Summary (the user confirms it at the gate, as today). A discovery question whose options are mechanisms (a version column, a trigger) is rewritten as the product rule ("what does the second editor see?"), and the mechanism goes under `### Deferred to architecture`. | `skills/start/SKILL.md` 1c/2, `roles/product-manager/role.md`, `discovery-frame.md` | New PM eval case `keeps-mechanisms-for-the-architect` passes 3/3; the existing PM cases still pass. |
| F2 | 6b decisions become Design Questions of the Architect's draft (`DQ: data model needed`, `DQ: API contract needed`, with the same criteria as today). The `contracts` Decision Page goes. `aidw decide data-model-needed` / `api-contract-needed` are still recorded, by the orchestrator, from the settled DQs. | `SKILL.md` 6/6b, `roles/software-architect/role.md`, `src/stages.ts` if a check reads the page | Architect eval case `settles-data-and-contract-needs` passes 3/3; `aidw stages` tests updated. |
| F3 | D2 in the skill: "Handle open decisions" (step 3) says that an objection to a settled DQ goes back to the Architect. The Database Architect and API Designer report a conflict with a DQ as `conflicts with DQ<n>: <why>`, not as an open decision. | `SKILL.md` step 3 and 6b, `roles/database-architect/role.md`, `roles/api-designer/role.md` | Database-architect eval case `reports-a-conflict-with-a-settled-dq` passes 3/3. |
| F4 | D3 in Ground rules: before asking in chat, check whether the recommendation copies existing behaviour. If it does, record `Assumed: <answer> (copies <file:line>)` under the Summary's assumptions. Also: never emit an internal note as user text; write to the user in their language. | `SKILL.md` Ground rules | A guard test reads the rule. |
| F5 | D4: move 6b before the system design round. Update stage order, `aidw stages` next-step text, and `aidw analyze`'s demands. The round's "nothing open" summary names the data model and contract when they exist. | `SKILL.md` 6/6b, `src/stages.ts`, its tests | Stage tests show the order. Analyze of a Change at each stage asks for the right next file. |
| F6 | D5: `aidw plan` / plan review adds an INFO line when a dependency wave cannot run in parallel ("T03 is risk high: it runs alone, so T03 and T04 run one after the other"). The gate's plan section shows it. | `src/planreview.ts` or `src/plan.ts`, `src/page.ts` gate plan section | Unit test on the trial's `tasks.yaml` shape. |
| F7 | D6: the gate intro, as written in SKILL.md step 9.5, says "once you agree to every section, I run `aidw approve` and Claude Code asks you to confirm; if it cannot ask (a headless session), type `/aidw:approve`". Write Before / After in the user's language. CLI-made gate sections take their headings and labels from the page `lang` (vi and en to start). | `SKILL.md` step 9, `roles/product-manager` (Before / After), `src/page.ts` | Page tests render a `lang: vi` gate with Vietnamese labels; a guard test reads the intro rule. |

Order: F1, F2, F3 and F4 touch different Roles and can run in parallel; F5 after F2 (both touch 6/6b in SKILL.md);
F6 and F7 in parallel with the rest.

**Done:** all tasks merged, the full suite and `aidw roster` are clean, and a short rerun of the trial's Change (to
the gate only) in a fresh copy of `aidw-trial-4` asks the user no technical question and shows the gate in Vietnamese.

## 5. Backlog (other trial findings, not in this plan)

- `aidw detect` warns "monorepo" for a `pnpm-workspace.yaml` with no `packages:`.
- The design-mode Decision Page for a Change that reuses the existing design system (a chat line would do).
- Asking the user to start the test browser in the middle of the data/contract stage. Move it to the intake
  preflight or leave it to `aidw run`.
- `aidw analyze` warnings with no way to record a reason ("depends_on without overlapping touches", "split T03").
- `aidw run --detach` does not ask for the confirmation its NEXT line announces when run from a non-tty shell.
- `runner.log` keeps only the tail of a session's last message, and the runner's cost is logged nowhere.
- PR body: generated sections before the summary, its H1 dropped, the manual check listed three times, and `main`
  named where the repo uses `master`.
- `aidw archive` commits the Documentation Role's README change that delivery left uncommitted.
- Headless: a question in an intermediate message is lost to a `claude -p` user (only the final message returns).
- A Change built on an unmerged earlier Change's branch: its PR carries both Changes.
