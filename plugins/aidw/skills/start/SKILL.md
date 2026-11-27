---
name: start
description: Start an aidw change from an idea, PRD, Upwork job description, client request or existing codebase, run the whole Analysis up to the single approval gate, and after the user approves carry on into the build. Use when the user runs /aidw:start.
disable-model-invocation: true
argument-hint: "<idea text | path to PRD/JD | 'this codebase'>"
---

# aidw: start a change and run the Analysis

The `aidw` CLI ships with this plugin as `${CLAUDE_PLUGIN_ROOT}/bin/aidw`. If a command fails with
`aidw: command not found`, run that path instead of `aidw` (here and in every command below).

You are running the **Analysis** of an Analysis-gated autonomous workflow. Everything you produce here is
reviewed by the user **once**, at the approval gate. After approval the workflow builds autonomously, so
the Analysis must be complete, consistent and honest about risks. This one command carries the Change all the way:
when the user approves at the gate, you approve and start the build yourself (step 10); the user does not type
`/aidw:approve` or `/aidw:run`.

Input: `$ARGUMENTS` (an idea, a path to a PRD/JD, pasted client text, or "this codebase").

## Ground rules

- **Write files with the Write tool, never with a shell redirect or heredoc** (`cat > file <<EOF`, `echo > file`): the gate
  denies those before approval and each denial costs a turn. This holds for `intake.md`, `quality.yaml`, `tokens.yaml` and every file below.
- Until approval you may write **only inside `.aidw/`**. The aidw gate hook denies everything else. Do not
  scaffold, install packages or create source files. Read the codebase freely.
- All state changes go through the `aidw` CLI (on PATH while the plugin is enabled). Never hand-edit `state:`
  or `approval:` in `change.yaml`.
- **Run `aidw approve` only in step 10**, after the user approved the gate page in this session. Approval is the
  user's decision: the gate turns the command into a permission prompt that the user confirms.
- Finding *facts* is your job: explore the repo or docs yourself (use an Explore subagent for wide searches). How
  existing code works today comes from the Existing System Report (step 1b), not from your own reading before it.
  *Decisions* belong to the user: put them to the user and wait.
- **Questions go on a Decision Page, not into the chat.** Read `$(aidw plugin-path library/decision-pages.md)` once, now. Every
  round of questions below, every open decision of a drafting Agent, the design direction and the Approval Gate are
  written as page data, rendered with `aidw page render <name>` and shown to the user as a link plus one or two lines; the
  text they paste back is checked with `aidw page answers <name>` before you record it. One simple question (a yes or
  no, a name) is still asked in the chat. Set the page's `lang` to the user's language. Every question with options,
  on a page or in the chat, shows a View (ADR-0017; the guide's "Every choice shows a View").
- Talk with the user in their language. Artifact content may be in their language, but keep every section
  heading and the `Source:` / `Mode:` lines exactly as specified: the CLI checks them.
- Vendored skills are loaded by path (`aidw vendor-path <upstream>/<skill>` prints it; then Read the file).
  Follow them, but the **adapter** notes below override where their output goes: there is no issue
  tracker; `.aidw/` is the tracker. Never run `/setup-matt-pocock-skills`.

## Stepping through the stages (which ones run at the same time)

The steps below are the stages of the Change's Workflow. The CLI knows what each stage reads and writes, so it, not
you, says which may run at the same time: `aidw stages <id>` lists them as `done`, `ready` or `now`, and ends with one
`NEXT:` line.

- `NEXT: stage <stage> (...)`: one stage. Do the step of this skill for it, as written.
- `NEXT: run these N stages in parallel, one subagent each, all in one message: ...`: do the interview part of each (the
  questions only you can ask, on one Decision Page where possible) and record its Decision Point, then spawn the drafting
  Agent of every listed stage **in a single message** (parallel Agent calls), each with the prompt of its step below.
- **The order of the design stages** is: the architecture draft (step 6), then the data model and API contract when
  needed (6b, stage `contracts`), then the system design round and Program Design (6c). The round confirms the whole
  design, and Program Design follows it directly.
- A stage that its Decision Point skips (`none`), or that you did yourself, is still done: report it.
- When a stage's work is done (its Agent replied and its open decisions are settled), report it on its own:
  `aidw stages --done <stage> --change <id>`. The output prints the next `NEXT:`. A gate stage is never reported: it is
  passed by the approval in step 10 (or `/aidw:approve`).

**A drafting Agent that asks another Role (a Consultation, ADR-0013).** An Agent whose Role declares `consults` (Product
Manager, UX Research and Software Architect ask Research; the Technical Planner asks the Software Architect) does not
guess a fact another Role owns: it writes `.aidw/changes/<id>/consult/<stage>-<role>.request.md` and ends its reply with
`CONSULT <path>`. Then:
1. `aidw consult <path> --change <id>`: it checks the pair, one level deep and at most 2 per Agent run, records `C<NN>`
   and prints the consulted Role's brief and `SPAWN` line. Refused: go on without it, telling the asker in one line.
2. Spawn that Agent with the printed prompt; the other stages of the group carry on meanwhile. It writes
   `consult/C<NN>.answer.md` and replies with its `STATUS:` line.
3. `aidw consult answer C<NN> --change <id>` writes the resume brief (original brief, progress note, answer path).
4. `aidw consult resume C<NN> --change <id>`: while the asking Agent still runs in this session, continue it with
   SendMessage and the printed line; otherwise spawn a fresh Agent of its Role with the resume brief. Report the stage
   when that Agent is done.
A question the consulted Role cannot answer goes back to the asker as an open question in its Artifact, and the gate's
Decision Page lists it with its words ("Questions no Role could answer"); you do not answer it yourself.
`aidw stages --done <stage>` and `aidw approve` refuse while a Consultation of the stage is in flight (open, or answered
and not yet resumed). `aidw stages` prints an open or answered Consultation first, so a new
session picks it up. Give a drafting Agent its stage id and your brief's path in the prompt, so its request can name them.

The CLI already leaves out a stage that reads another's output or writes the same Artifact, a second browser user (the
`design` stage screenshots its mocks), and anything past `parallel.max`. Stages that write the same file (two sections
of `analysis.md`, say) never run together; only the parts of `decisions.yaml` are exempt, because `aidw decide` writes
them one at a time before you spawn. Report every stage yourself, including one a Decision Point skipped (`none`): the
CLI never counts a stage done because its files exist. Only a Change started before `stages.yaml` existed (no such file in
its folder) is caught up from its files: a stage whose Artifacts are all on disk and filled in (no `TODO(aidw)` left in
its sections) counts as done; a skipped stage there is still reported with `--done`. Following the steps one by one, in order, is
still correct; the `NEXT:` line only saves waiting.

## 0. Preconditions

Run `aidw status`. If it reports no `.aidw/`, follow `$(aidw plugin-path skills/init/SKILL.md)` first (it runs `aidw init`). If a change is
already `awaiting_approval` or later, tell the user and stop: one change at a time.

## 1. Intake

1. Pick a change id: `YYYY-MM-DD-<short-kebab-slug>` (today's date).
2. Pick the Workflow. The default follows the project (`product` for a new project, `feature` for an existing codebase); you
   only propose another: a **bug report** in an existing codebase is a `bugfix` and a request to **review** the code ("audit", "check", "is it secure") is an `audit` (see "Bugfix" and "Audit" below). Say which one you
   propose and why, and wait for the user to confirm it.
   `aidw change new <id> --title "<title>" --input-type <idea|prd|upwork_jd|client_request|codebase> --workflow <product|feature|bugfix|audit>`
   Always pass `--workflow`: it records the confirmed Workflow, and a `product` change gets the place for its scope round (step 2b) that way.
3. `aidw transition <id> intake`
4. Fill `.aidw/changes/<id>/intake.md`: paste the original request **verbatim** (or its path), record the
   client's explicit constraints, including any stack the client requires.

## 1b. Assessment and the Existing System Report (brownfield only)

When `.aidw/project.yaml` says `kind: brownfield` (or the input type is `codebase`), understand the existing
system before asking anything; the grilling then asks only what the code cannot answer. A greenfield project skips
this step: there is no code to describe. A greenfield `bugfix` still has the `assessment` stage in its Workflow:
report it done with `aidw stages --done assessment --change <id>`.

You do not describe the code yourself. You know the request, and a description written by someone who knows the
change bends toward it (ADR-0016). Research Agents describe it from neutral questions, in the **Existing System
Report** (`.aidw/changes/<id>/existing-system.md`).

1. The working tree must be clean (`git status`) and `aidw detect` must print no `WARNING` (no `.gitignore`,
   tracked or unignored `node_modules/`): aidw commits per task with `git add -A`. Ask the user to commit or
   stash first, and fix the warnings (see `/aidw:init` step 4).
2. **Look, do not study.** Read `.aidw/project.yaml` (`stack`, `detected`), `aidw detect`, the README, the
   `package.json` scripts and the folder tree: enough to name the areas of the code. Do not follow flows or read
   implementations; that is the Research Agents' work.
3. **Write the questions before you read the request again**, to `.aidw/changes/<id>/existing-system/questions.md`:
   2 to 7 questions about how the code works today, under `## Group <n>: <area of the code>` headings, numbered
   `1.`, `2.`, ... across the groups. Each question:
   - asks what exists, where it lives, how it runs or how it is tested;
   - starts from the code's own places (a folder, a route, a table, a script), never from a noun of the request: no
     feature name, no behavior asked for, no "today" set against a wish. "How are reminders sent?" leaks a request
     for reminders; "Which jobs run in the background, how are they scheduled, and which tests cover them?" does not;
   - can be answered from the code alone.

   Then reread the request for coverage only: an area the change will touch that no question reaches gets one more
   question, worded the same neutral way, keeping the total within 7 (3 for a bugfix or small change). Put
   questions that read the same code in one group; each group is one Research Agent. A `bugfix`, or a change you
   expect to be `Size: small`, asks at most 3 questions in one group.

   ```markdown
   # Existing system questions

   ## Group 1: HTTP routes and the database (app/api/, lib/db.ts)

   1. How does a request to a route under `app/api/` reach the database, step by step, and which tests cover it?
   2. Which tables exist, and where are they created and migrated?

   ## Group 2: background work and email (lib/jobs/, lib/mailer.ts)

   3. Which jobs run outside a request, how are they started, and how are they tested?
   ```
4. **One Research Agent per group, all in one message.** Spawn one **`aidw:research`** per group with this prompt and
   nothing else (never the request, `intake.md` or `analysis.md`):
   `Change <id>. Existing System Report, group <n>. Answer the questions of group <n> in .aidw/changes/<id>/existing-system/questions.md with your codebase-research skill, write .aidw/changes/<id>/existing-system/part-<n>.md, and reply with the path and the answer in three lines.`
   With one group (a `bugfix` or a small change) the one Agent writes the report itself, and step 5 is skipped:
   `Change <id>. Existing System Report. Answer every question in .aidw/changes/<id>/existing-system/questions.md with your codebase-research skill and write the report of its synthesize section to .aidw/changes/<id>/existing-system.md. Reply with the path and the Summary.`
5. **The merging Agent.** When every part is written, spawn one more **`aidw:research`** with this prompt and nothing else:
   `Change <id>. Existing System Report: merge .aidw/changes/<id>/existing-system/part-*.md, the answers to .aidw/changes/<id>/existing-system/questions.md, into .aidw/changes/<id>/existing-system.md with the synthesize mode of your codebase-research skill. Read code only where two parts disagree; list a question no part answered under "Not answered". Reply with the path and the Summary.`
   A question under "Not answered" stays there: the interview or the Software Architect takes it up; do not answer
   it from your own reading.
6. Write what the report found where it belongs, citing its sections: `.aidw/architecture/overview.md` (the
   architecture as it is, folder structure, integrations), `.aidw/domain/model.md` (entities and rules the code
   already has), and the conventions the code follows into `.aidw/constitution.md` (naming, folders, state
   management, styling, test style). These describe the current system; the change adds to them later.
7. **Health baseline**: run the existing checks that the quality layers will use (`detected.suggested_layers`:
   lint, typecheck, build, tests) once, now. Record which pass and which already fail. A check that fails
   before any change is not this change's fault: the user decides at the gate whether the change fixes it,
   or the layer leaves it out with a reason (`## Quality profile`).
8. Fill `## Existing system` in `analysis.md`: the report's Summary word for word, then
   `Full report: .aidw/changes/<id>/existing-system.md`, the health baseline, the capabilities this change touches
   and what must not change. `aidw analyze` checks the questions (2 to 7; for a `bugfix` at most 3 in one group),
   a part per group, the report's `## Summary` and `## Not answered`, and that this section names `existing-system.md`.
9. Keep the stack: `Source: client` (the existing code is the client's choice, Q9). Never migrate frameworks,
   package manager or libraries unless the user asks for exactly that.

## 1c. Size, 2. Discovery (one interview, in stages)

The **Interview** stays in this session because only you can talk with the user. It is **one conversation**: the user
is never handed from one interviewer to another, and no stage asks again what an earlier one recorded. Start with
`aidw transition <id> analyzing`. Each stage reads one Role's "Interview (main session)" section and its skill, and
records its rounds in `analysis.md` before the next begins. Each round is one Decision Page (`discovery-1`, `discovery-2`, ...,
with `role:` set to the Role asking): a choice with its options, criteria and your recommendation, an open question with
your suggested answer. The checked answer goes into the discovery appendix word for word.

1. **The job (Product Manager).** `$(aidw plugin-path roles/product-manager/role.md)` and its `discovery-frame` skill:
   the size (`Size: small|normal` in the Summary, which the user confirms at the gate), the job to be done, today's
   workaround, the measure of done, scope and what is out. A `product` change ends this stage with the scope round
   (step 2b), then returns to stage 2 of step 2. A `Size: small` change stops here.
2. **Rules and edges (Business Analyst).** `$(aidw plugin-path roles/business-analyst/role.md)` and its
   `rule-and-edge-elicitation` skill: for each behavior, the rules behind it, an example of each, and the edge and
   failure paths.
3. **The users (UX Research), only when step 2c decides `journeys`.** `$(aidw plugin-path roles/ux-research/role.md)`:
   only what the journeys still need.

The interview ends when the record is complete on disk: the drafting Agents below read that record, not this conversation.

## 2c. Research and user research (each only when needed)

Two Decision Points, decided with the Product Manager's hat on. Most Changes answer `none` to both: an active Role
does not run on every Change, and each of these costs an Agent. Recommend an answer and say why: put both as questions
(`decision: research-needed`, `decision: ux-research-needed`, the Decision Point's answers as option keys) on the last
discovery page, or on a page of their own.

- `aidw decide research-needed <market|feasibility|both|none> --reason "<why>"`. Not `none` when the scope depends on
  what competitors do or users of similar products complain about (`market`), or when nobody knows whether the stack
  or a named service can do something the request needs (`feasibility`). Then spawn **`aidw:research`** with this prompt
  and nothing else:
  `Change <id>. Question: <the one question, and the decision it serves>. Answer it as your Procedure says in .aidw/research/<id>.md and reply with the answer in three lines.`
  Put its answer to the user where it changes a decision, and record the outcome in the discovery appendix.
- `aidw decide ux-research-needed <journeys|none> --reason "<why>"`. `journeys` when the Change has UI and more than
  one kind of user, a flow across several screens, or a stated accessibility need. Then run interview stage 3 above
  and spawn **`aidw:ux-research`** with this prompt and nothing else:
  `Change <id>. The discovery interview is recorded in .aidw/changes/<id>/analysis.md. Write .aidw/changes/<id>/journeys.md as your Procedure says and reply with the user kinds, the stages no requirement covers, and what is assumed.`

## 2b. Scope round (`product` only)

A `product` change settles its scope in the discovery interview, before any requirement is written (ADR-0011). It is a
round of questions, not a gate: nothing is approved or frozen here, and the user approves the whole package once, at
step 9. Skip this step for `feature`, `bugfix` and `audit`.

1. Write one Decision Page named `scope` (`layout: questions`, `kind: scope`, `role: product-manager`) with exactly these
   question ids, each with your recommendation from what the interview found: `vision` (open: who it is for and what
   success looks like), `scope` (`multi` choice: the capabilities, one option each, with a `view` of kind `tree` that
   shows them as the user will meet them), `mvp` (open, with your suggested
   answer: the smallest cut worth building first, and why) and `out` (open: what is deliberately not built now). None of
   them is `optional`. `aidw page render scope` refuses the page
   without one of them.
2. Show the link and stop. When the user pastes the answer, `aidw page answers scope` checks it; record the printed lines
   word for word under `### Scope round` in the discovery appendix of `analysis.md` (add the heading if it is
   missing). A note that changes the scope is settled in the chat first. `aidw analyze` refuses a `product` package whose
   scope round is missing or leaves one of the four questions unanswered.
3. Continue with the rules and edges (step 2, stage 2), then step 3. The Product Manager drafts inside the recorded scope.

A change created by an older aidw may still be in `awaiting_scope_approval` with a `brief.md`: aidw reads it as
`analyzing` (discovery continues) and its brief stands in for the scope round. Continue with step 3; nothing waits for
a scope approval any more.

## 3. Domain model and requirements, 4. Delta specs (two drafting Agents, in this order)

Spawn the **`aidw:product-manager`** Agent with this prompt and nothing else:
`Change <id>. The discovery interview is recorded in .aidw/changes/<id>/analysis.md. Draft the domain model and the requirements as your Procedure says, and reply with the paths you wrote and every decision still open.`

When it is done, spawn the **`aidw:business-analyst`** Agent with this prompt and nothing else:
`Change <id>. The discovery interview is recorded in .aidw/changes/<id>/analysis.md and the requirements are drafted. Draft the delta specs as your Procedure says, run aidw validate <id>, and reply with the paths you wrote and every decision still open.`

Each drafts in a fresh context from the record (the "Procedure (drafting)" of its `role.md`): the Product Manager
writes the domain model, ADRs and `.aidw/requirements/<id>.md`; the Business Analyst writes the delta specs and the
brownfield baselines and runs its requirement quality check. Do not redo their work or read the artifacts back in
full. Run `aidw validate <id>`; put the open decisions of a reply to the user (one Decision Page for two or more, or for
one with real alternatives, using the Agent's recommendation as `recommend`; the chat for a single simple one), record the
answer in `analysis.md`'s discovery appendix and spawn that Agent again with the answer, until validation is clean and
nothing is open.

**A reply that says `conflicts with DQ<n>: <why>`** is not an open decision (a Role after the Software Architect, such as
the Database Architect or the API Designer, disagrees with a settled Design Question). It never goes to the user as
it is. Spawn `aidw:software-architect` again with the objection and the DQ: it keeps the DQ (and says why) or changes
it, in `### Design Questions`. Spawn the Role that objected again afterwards. Only a DQ that comes back `Open` reaches
the user, in the system design round.

## 5. Design decision (Q3)

Detect design assets: Figma links, screenshots, an existing design system, brand guides. Then choose the
mode with the user, as a question on a Decision Page (`design`) whose options are the modes that fit this change, with a `view` (a `tree` of what each mode puts under `.aidw/design/`). Read `$(aidw plugin-path roles/ui-ux-designer/references/design-tokens.md)` for how each mode produces tokens.

- `existing`: assets exist. Collect them into `.aidw/design/` (Figma via the Figma MCP tools, screenshots, notes)
  and extract the tokens from them (Figma variables, the brand guide, the live site's CSS).
- `claude_design`: the user designs in Claude Design. Ask them to export it ("Send to local coding agent")
  and save the bundle under `.aidw/design/`. Wait for it; this happens before approval. Take the tokens from the
  bundle's CSS custom properties / theme.
- `ai_design`: put two or three **directions** to the user on the same Decision Page before writing anything: each
  direction is one option whose `html` slot shows the main screen as a small static mock built from that direction's
  own colors, type and spacing (the design-tokens reference, "Showing a direction"). Then write
  `.aidw/design/direction.md` for the chosen one: personality, typography, spacing, key layouts, references, and the
  tokens.
- `hybrid`: say which parts follow references and which parts AI designs; tokens cover both.

Record the outcome as a Decision Point: `aidw decide design-needed <full-design|reuse-existing|no-ui> --reason "<why>"`
(`existing` -> `reuse-existing`; `claude_design`, `ai_design`, `hybrid` -> `full-design`; a change with no UI -> `no-ui`).
`aidw analyze` refuses `no-ui` when a task changes UI. The user sees every decision at the gate: `aidw decisions <id>`.

**Every mode ends with `.aidw/design/tokens.yaml`** whenever the plan has UI work (`aidw analyze` refuses the
package without it). Each token has a `use` rule saying where it must appear ("accent: Focus mode label, start
button, progress ring"). The `use` rules are what reviewers check on screenshots, so make them concrete. The
user sees the tokens at the gate: the design section of the gate page shows them as swatches and type samples.

## 6. Architecture and stack

**Interview (this session).** The architecture is mostly decided from the requirements and the stack pool, so ask the
user only what they cannot answer: a stack the client requires, hosting, auth or payment providers, integrations,
limits. Read `$(aidw plugin-path roles/software-architect/references/stack-pool.md)` and put the questions on one Decision
Page (`stack`, `role: software-architect`), each with your recommendation and with `criteria` that show what the
options really trade (monthly cost, work to operate, lock-in, what the client already uses). Record the answers under `## Stack` in `analysis.md` (`Source: client|ai|fallback` and why) before
drafting.

**Drafting Agent.** Spawn **`aidw:software-architect`** with this prompt and nothing else:
`Change <id>. The requirements and specs are drafted; the stack decisions are in .aidw/changes/<id>/analysis.md under "## Stack". Draft the architecture, ADRs, constitution and project fields as your Procedure says, run aidw validate <id>, and reply with the paths you wrote and every decision still open.`

Its Procedure (`$(aidw plugin-path roles/software-architect/role.md)`) holds the stack priority
(client > AI within the pool > fallback), `.aidw/architecture/overview.md`, ADRs, `.aidw/constitution.md` and the
`stack:` and `design_mode:` fields of `.aidw/project.yaml`. It lists every technical choice under `### Design
Questions` in `## Architecture`: settled ones with `Chosen:`, `Why:` and `Rejected:`, and at most 5 left `Open:` for
the user (hard to reverse, options about equal, or a change in cost or operation), each with its options, Views and
metrics in the reply. Two of those questions are always settled, never left `Open`: `DQ: data model needed` and
`DQ: API contract needed` (step 6b).

## 6b. Data model and API contract (each only when needed)

Two choices, made by the Software Architect in its draft as Design Questions (`DQ: data model needed`, `DQ: API contract
needed`), never put to the user as a page of their own. The Architect settles both: it recommends an answer and the DQ
keeps the reasons (`Chosen:`, `Why:`, `Rejected:`). `none` is right for a Change that adds no table and no operation
another part calls. Read the settled DQs and record them, with the same reasons:

- `aidw decide data-model-needed <design|none> --reason "<why>"`. `design` when the Change adds or alters tables or
  collections beyond a column or two, has a rule the database must enforce (uniqueness, no double booking), or changes
  something that already holds data.
- `aidw decide api-contract-needed <openapi|actions|none> --reason "<why>"`. `openapi` when the Change adds or changes
  HTTP routes that a separate client, another service or a parallel task will call; `actions` for server actions or
  RPC with the same need; `none` when one task owns both sides.

A DQ that is missing or left `Open`: spawn `aidw:software-architect` again to settle it (these two are never put to the
user). The stage `contracts` runs after the architecture draft and before the system design round, so the user
confirms a design whose data model and contract already exist.

Spawn the chosen ones **in one message** (they do not depend on each other), each with its prompt and nothing else:

- **`aidw:database-architect`**: `Change <id>. Requirements, specs and architecture are drafted. Design the data model as your Procedure says in .aidw/changes/<id>/ and reply with the paths, the entities, the irreversible steps and every decision still open. When a design choice goes against a settled Design Question, reply "conflicts with DQ<n>: <why>" instead of opening a decision.`
- **`aidw:api-designer`**: `Change <id>. Requirements, specs and architecture are drafted; the api-contract-needed decision is <openapi|actions>. Write the contract as your Procedure says in .aidw/changes/<id>/ and reply with the paths, the number of operations, any breaking change and every decision still open. When a design choice goes against a settled Design Question, reply "conflicts with DQ<n>: <why>" instead of opening a decision.`

Handle their open decisions as in step 3; a `conflicts with DQ<n>` goes back to the Software Architect first (step 3). A
breaking change or an irreversible step goes into the Summary's risks: the user decides it at the gate. The planner
reads `data-model.md` and `api-contract.md` when they exist.

## 6c. System design round and Program Design

**System design round (stage `system-design-round`).** A round of questions, not a gate: nothing is approved here
(ADR-0015). `aidw stages <id>` says what it asks.
- Open Design Questions: one Decision Page `system-design` (`layout: questions`, `role: software-architect`), one
  question per open `DQ<n>` with that id, the Agent's recommendation as `recommend`, its options each with a `view`
  of its code shape (a diff for a shape that exists, the full shape for new code) and the Agent's metrics as
  its `metrics` (at most 4, `{name, value, why}`, the same names on every option; a figure only when known,
  otherwise low, medium or high with why; `library/decision-pages.md`, "Metrics"). Show the link
  and stop. Record the lines `aidw page answers system-design` prints word for word under `### System design round`
  in `## Architecture`, and turn each open question into a settled one (`Chosen:`, `Why:`, `Rejected:`). When an
  answer goes against the Agent's recommendation, spawn `aidw:software-architect` again with the answers to bring
  the architecture in line.
- Nothing open: one question in the chat (`library/decision-pages.md`, "One question after a design"): two or three
  lines of summary, the link to `.aidw/architecture/overview.md` and a View of the main shape as a fenced block. The
  summary names the data model and the API contract when the Change has them (step 6b), with the link to each file.
  Record the reply as `confirmed: <the reply>` under `### System design round`.
- `Size: small`: no round. Report the stage done.

`aidw stages --done system-design-round` refuses while a question is open or the round is not recorded.

**Program Design (stage `program-design`, right after the round).** Spawn **`aidw:software-architect`** again with this prompt
and nothing else:
`Change <id>. The system design round is recorded in .aidw/changes/<id>/analysis.md under "## Architecture". Write .aidw/changes/<id>/program-design.md as your program-design skill says (the short version: Size is <small|normal>), and reply with the path, the files per mark and every shape still open.`
It writes the file-tree diff and the main signatures and contracts, with call trees, component trees, a dependency
map or pseudocode where they help. The planner cuts the tasks from it, the gate shows it, and code that differs from
it after approval is a Deviation. `aidw stages --done program-design` refuses it without its required parts. Handle
its open shapes as in step 3.

## 7. Plan (task graph)

Spawn **`aidw:technical-planner`** with this prompt and nothing else:
`Change <id>. Requirements, specs, design, architecture and constitution are drafted. Break them into .aidw/changes/<id>/tasks.yaml as your Procedure says, run aidw plan and aidw analyze <id>, and reply with the number of tasks and waves and every decision still open.`

Its Procedure (`$(aidw plugin-path roles/technical-planner/role.md)`) holds the `tasks.yaml` format, who owns a task,
and the rules of a good plan (vertical slices, parallel waves, `aidw plan` shape, UI owners, commit types); its
`task-interfaces` skill cuts the tasks from the Program Design, and `scaffold-tasks` and `migration-tasks` cover a new
project and a migration. Handle its open decisions as in step 3.

Each task may carry `patterns` (code to imitate, shown in its brief), `docs` (libraries to read up on) and `manual`
(checks for the user, listed at the gate and at delivery). **The Docs Briefs come next, before the plan review**:
run `aidw docs-brief --change <id>`. For each line it prints MISSING, STALE or INVALID, spawn one `aidw:research` Agent,
all in one message, with: `Write the Docs Brief for <entry> with your docs-research skill, to <path>.` A FRESH brief is reused as it is. Run the command again until every line is FRESH; `aidw analyze` refuses
the package while one is not.

## 8. Test plan, quality, deploy and permissions

Read `$(aidw plugin-path roles/qa/references/quality-layers.md)` and `$(aidw plugin-path company/permissions.md)`.

**Drafting Agent (QA).** For a `Size: normal` change, spawn **`aidw:qa`** with this prompt and nothing else:
`Change <id>. Specs, architecture and tasks are drafted. Write the test plan, the layers of quality.yaml and the Quality profile as your Procedure says, run aidw analyze <id>, and reply with the number of cases per layer and every decision still open.`
It writes `test-plan.md`, the `layers:` of `quality.yaml` and `## Quality profile`. A gap between its plan and the
task graph goes back to the planner (spawn it again with the gap). For a `Size: small` change write the layers
yourself, as below.

**This session**, wearing the QA hat for the environment and the Release hat for deploy and permissions
(`$(aidw plugin-path roles/release/role.md)`, "Interview"), completes the file and checks what only a session with the
user can check:

- `.aidw/changes/<id>/quality.yaml`: check the layers have the exact commands for the chosen stack, and add the deploy
  target and command, the smoke checks, and the tier-2 resource keys. These commands run unattended after
  approval, so make them non-interactive.
- `## Quality profile`: which layers run and why, scaled to the project's risk (Q5: comprehensive by default).
  `code`, `unit`, `e2e` are expected. **A change with UI always gets the `a11y` layer (axe through Playwright)**, even a small
  one: `aidw analyze` refuses a UI plan without it unless `## Quality profile` says why. Run `aidw detect`: when it shows no
  `a11y tests: axe-core`, the plan adds it, and that is the one dependency a small UI change may add even when the request says
  "no new dependencies" (a dev dependency for tests, never a runtime one): `@axe-core/playwright`, the `a11y` Playwright project
  and `e2e/a11y.spec.ts` go in the `touches` of the UI task (or the plan's first task), and you say so at the gate. Add `ui-ux`
  (screenshots at three viewports + `review: ui`) whenever the change has UI; `security` (audit + secret scan + `review: security`) whenever it has
  server code, auth, user data or a database; `performance` (Lighthouse budgets) for a public web app. The
  profile's "Recommended layers" section has the commands and the test files the scaffold task must add.
  Justify every layer you leave out; the quality report lists it as not covered.
- `## Deploy strategy`: none | local | preview, the provider, the preview environment variables and where their
  values come from. Production is never automatic: it is tier 3 and asks.
- **Environment preflight.** The layers run unattended in this Claude Code session, under its sandbox. Run
  `aidw doctor <id>` now: it checks the binaries of every quality command, the package manager, the package
  store and registry, Chrome CDP and the Vercel login and link. Settle every FAIL with the user before approval and
  record the WARNs under the Summary's risks: a layer that cannot run here fails in verify and escalates. Also
  check `npx lighthouse --version` yourself when the profile has a `performance` layer.
- **E2E browser.** Claude Code's sandbox usually blocks launching Chromium, so the default is **Chrome over
  CDP**: the user runs Chrome outside the sandbox with a debugging port, and Playwright connects to it (setup
  and fixture in the quality-layers profile, "E2E browser over CDP"). There is no fixed port: run
  `aidw browser start` (Chrome on a free port it picks, one profile per project) and check with `aidw browser status`.
  If the sandbox blocks the launch, ask the user to run `aidw browser start` in their own terminal and check again.
  Write the CDP setup into the e2e layer and a Decision to honor (`E2E connects to Chrome over CDP at E2E_CDP_URL,
  which aidw sets from aidw browser start; no default port`). Use a launched browser instead only if the user prefers it and a real launch works
  in this session.
- **Parallel.** `parallel: { max: 3 }` in quality.yaml is the default (1 turns waves off). A wave task runs in
  `.aidw/run/worktrees/<change>/<task>`, inside the project, so dependencies resolve from the main checkout's
  `node_modules`. If the stack needs its own install per worktree, add an offline install as `parallel.setup`
  (e.g. `pnpm install --offline --frozen-lockfile`); a task whose setup fails runs sequentially instead.
- `## Permissions`: one bullet per tier-2 resource, starting with its key, e.g.
  ``- `vercel-preview`: preview deploy of the demo, deleted after handoff``, or `None`. `aidw analyze` checks
  that every key in quality.yaml is named here.
- `grants:` in quality.yaml: what the user grants at the gate (push remote and base, envelope, Agent-run cap;
  `aidw plugin-path company/permissions.md`, "Grants at the Approval Gate"). Draft `push: { remote: origin, base: <the
  branch the change starts from> }` and leave the rest out; the gate page shows them and the user changes them there.

## 9. Analyze and present

1. Complete every section of `.aidw/changes/<id>/analysis.md`. Replace every `TODO(aidw)`: read the file once, then write the
   whole completed file with **one Write** (keep every heading and the `Source:` / `Mode:` / `Size:` lines). One Edit per section
   is about twenty calls in a row, and the orchestrator's context is re-read on each.
   `## Decisions to honor` lists every concrete choice the code must keep and a reviewer can check: names and keys
   (storage keys, routes, env var names), formats, tools and package manager, libraries, conventions, limits. Take
   them from the discovery answers, the stack, the architecture and the design. Each one records what was chosen,
   why, and why the other options were not, so an implementer does not "fix" it back to a rejected option:

   ```markdown
   - D1: Times are stored in UTC and shown in the clinic's timezone.
     Why: patients book across a daylight-saving change (architecture.md, "Time").
     Rejected: clinic local time (a clock change moves booked slots by an hour).
   ```

   `Why:` and `Rejected:` are plain indented lines, not sub-bullets. Write `Rejected: none` when no other option was
   on the table (a key name, say). `aidw analyze` warns about a
   decision without `Why:` or `Rejected:`. Implementers may not deviate from these without escalating, so be
   precise and include only real decisions. The `## Summary`
   must fit one page: goal, scope, the key decisions, and the risks and assumptions that need attention.
   `## Before / After` has `### Before` and `### After`, 3 to 6 `- ` lines each, as the user sees it; Before draws
   from `existing-system.md` and names it when the Change has that report, otherwise from today's workaround.
   `### Deferred to architecture` (in `## Requirements and scope`) lists the technical questions discovery put
   aside as `- DA1: <question>`, or says "None"; each id has its answer, `- DA1: <answer>`, in `## Architecture`.
   `aidw analyze` checks all three for a Change created with `analysis_template: 2`.
2. Run `aidw analyze <id>` and `aidw validate <id>`. Fix every error and re-run until both are clean.
3. **Independent review** (stage `plan-review`). Run `aidw plan-review <id> --brief` (it refuses while `aidw analyze` has
   errors) and spawn the reviewer `aidw:code-reviewer` with exactly the printed `SPAWN` prompt. It grades the architecture, the plan
   and the test plan against a fixed list (every approved scenario has a task, no task outside scope, the constitution is
   followed, no needless complexity), writes `.aidw/run/review-plan-<id>.md` and replies with one line. Every round
   needs its own brief (the CLI records only the round it briefed). Record it:
   `aidw plan-review <id>`.
   - `pass`: the stage is done; go on.
   - `fix`: the output lists each finding with the Role that fixes it: the owner of what it names when this Workflow has
     a stage for that Role, otherwise `the lead` (you). Spawn each Role
     again with its findings, or fix what you wrote yourself, re-run step 2, then `aidw plan-review <id> --brief` again.
     The CLI counts the rounds: after 2 fix rounds the third verdict is final, and what is still open goes to the top of
     the gate page by itself. Never edit the verdict file or `plan-review.yaml`; the CLI refuses a verdict changed after
     it was recorded, and the gate hook lets only the code-reviewer write the verdict.
4. `aidw transition <id> awaiting_approval` (it re-runs both checks and refuses until the review is recorded).
5. Present the package as a gate page (`layout: gate`, name `gate`, `change: <id>`): one section each for the summary
   and scope, the key decisions, the stack, the design (tokens as swatches in its `html` slot when there is UI), quality
   and deploy, requested permissions, and risks and assumptions. The CLI puts `## Before / After` of `analysis.md`
   first of all (a section you write with the id `before-after` replaces it), then the review's open findings, and
   adds the Program Design (`program-design.md` as Views; a section you write with the id `program-design` replaces
   it), the Decision Points and the plan (its stages, and each task's patterns, Docs Briefs and checks for the user).
   Name
   `.aidw/changes/<id>/analysis.md` in the intro. Tell the user the link, and that once they agree to every section
   (or type `/aidw:approve`) the build starts by itself.
6. **Stop and wait for the answer.** Do not start building before it. When the user pastes the page's answer, check it:
   every section agreed (or the user says they approve) goes on to step 10; a section marked for a change is revised as
   under "Revising".

## 10. Approve and build (same session)

Only when the user, **in this session**, answered the gate page agreeing to every section, or said "approve" (or typed
`/aidw:approve`). Anything else (a section marked for a change, a question, silence) is not an approval: never run
`aidw approve` on your own reading of the package.

Follow steps 2 to 6 of `$(aidw plugin-path skills/approve/SKILL.md)`, as if the user had typed `/aidw:approve <id>`:
validate and analyze, confirm the push grant when `quality.yaml` has one, `aidw approve <id>` (the user confirms its
permission prompt; if they decline, stop and do not retry), then follow the `NEXT:` line it prints. The CLI decides
where the build runs from the number of tasks; do not choose yourself:

- `NEXT: build here: ...` (3 tasks or fewer): follow `$(aidw plugin-path skills/run/SKILL.md)` for `<id>` now.
- `NEXT: start the runner: <command>` (more than 3): run exactly that command, with the sandbox disabled, as step 6 of
  the approve skill says (the runner start asks the user when aidw is loaded from a folder); tell the user how to follow
  and stop it, then stop.

## Bugfix

A change created with `--workflow bugfix` takes the small path (steps 1c to 9 with `Size: small`: at most 3 questions, at
most 3 tasks, no domain model, design tokens or ADRs; layers `code` + `unit`, plus `e2e` and `a11y` when UI is touched, plus `security` when the fix touches an HTTP route's input handling, auth or secrets: a bug in input validation is a security-relevant change even when an earlier audit covered the same code) with two
differences. The behavior is already specified, so the change has **no delta spec** (`skip_specs` is set for you), and the
planner writes a `type: fix` task whose regression test fails first on the current code (the implementer's brief says so).

**Skip the drafting Agents.** A defect has no new domain, requirements or architecture: do **not** spawn
`aidw:product-manager` or `aidw:software-architect`, and write no `requirements/` file, domain model, ADR or constitution change
(a run that spawned the Product Manager produced a requirements document and an extra Agent for a one-line fix). Do steps 1b to
2 and the health baseline yourself (step 1b with at most 3 questions in one group, so one Research Agent writes the
report; skip item 6 of step 1b), then write the diagnosis into `analysis.md` in your one Write: the **root cause** (file and
line), the **scope** (what changes, what does not), the **Decisions to honor** (the exact response or behavior after the fix, what
must stay as it is), and the regression test the fix needs. `## Before / After` is the bug as the user meets it and the
behavior after the fix (3 to 6 lines each); `### Deferred to architecture` says "None". The sections for Domain, Stack,
Design, Architecture and Specs say "n/a for a bugfix". A bugfix has no system design round; write its short Program
Design yourself (stage `program-design`): `.aidw/changes/<id>/program-design.md` with `## File tree` (the files the
fix changes, marked `~`, and the regression test, `+`) and `## Signatures and contracts` (the changed shapes as
diffs). A bugfix has no `design-needed` decision (do not run `aidw decide design-needed`). Then spawn only the planner (step 7) with this
prompt instead of the one there:
`Change <id>. The diagnosis (root cause, scope, decisions to honor) is in .aidw/changes/<id>/analysis.md and the Program Design in .aidw/changes/<id>/program-design.md; there are no specs. Write .aidw/changes/<id>/tasks.yaml with one task of type fix (at most 3), with scope: <the capability it touches> and a regression test in its touches, run aidw plan and aidw analyze <id>, and reply with the number of tasks and every decision still open.`

The task's **regression test is proven by the CLI**: at its checkpoint aidw runs the new test files against the base commit, and a
test that passes on the old code fails the checkpoint.

The independent review of step 9 runs for a bugfix too (one code-reviewer Agent on a plan of at most 3 tasks).
There is **no approval gate** while the fix stays small. After `aidw transition <id> awaiting_approval` run
`aidw approve <id> --auto` instead of stopping:

- It approves itself (`approved by aidw (bugfix boundary)`; hash and drift protection apply as ever). Tell the user in
  one line what will be fixed, then follow its `NEXT:` line as in step 10 (a fix of at most 3 tasks is built here). A production deploy still asks.
- It refuses when the plan has more than 3 tasks, adds a migration or needs a delta spec. The change is now a `feature`
  change: present the package as in step 9 and stop for `/aidw:approve`.
- It refuses when the plan review ended with findings still open: present the package as in step 9 (the page lists
  them first) and stop for `/aidw:approve`.

## Audit

A change created with `--workflow audit` is **read-only**: no spec, plan, approval or build, and the gate stays closed to
project files for the whole change. Do not follow steps 1b to 9. Instead:

1. Intake as in step 1: write what to audit, and why, in `intake.md`. `aidw transition <id> intake`, then `analyzing`.
2. Choose the lenses with the user (`security`, `code-quality`, `ui`), recommending the ones the request implies (one
   `multi` question with `decision: audit-lenses` on a Decision Page, whose `view` is a `tree` of the parts of the
   project each lens reads), and
   record them: `aidw decide audit-lenses security,code-quality --reason "<why>"`.
3. For each lens: `aidw audit brief <lens>`. It prints the brief and the `SPAWN` line; spawn that Agent (`aidw:security`,
   `aidw:code-reviewer`, `aidw:ui-ux-designer`), all of them in one message, each with exactly the printed prompt. Each writes
   `.aidw/run/audit-<lens>.md` and replies with one line.
4. `aidw audit report`. It assembles `audit-report.md` (findings by severity, numbered `F-01`...). A lens that answered in a
   wrong shape is named: spawn that reviewer once more.
5. `aidw page audit --change <id> --lang <en|vi>` before archiving: it writes the findings as a pick list and prints its
   link. Then `aidw transition <id> delivered` and `aidw archive <id>`. Tell the user the counts by severity, what was not
   covered, the report's path and the link.
6. The user picks what to act on, on the page. Check the pasted text with `aidw page answers audit-<id>`; its `NEXT:`
   line is the command: `aidw audit picks F-01,F-03 --change <id>` prints the picked findings as the request of
   a new change; start it with this skill as a `bugfix` (a small, clear defect) or a `feature`.

## Revising

If the user asks for changes while the change is `awaiting_approval`: `aidw transition <id> analyzing`,
revise, then repeat step 9. Its step 3 depends on what changed: when the reviewed plan is untouched (tasks, specs,
architecture, constitution, contracts, test plan; a summary edit does not count) the recorded review still counts and
`aidw plan-review --brief` says it is finished. When any of them changed, `aidw transition <id> awaiting_approval` is
refused ("the plan changed since the review") and a new review runs, with its own 2 fix rounds.
