## Decision Pages: how the user is asked to choose

A wall of options in the terminal is hard to compare. So a round of questions, a pick list and an Approval Gate
summary are shown as a **Decision Page**: one HTML file the user opens, with the options side by side. The page is
a view. What the user chooses comes back as text and is recorded where it is recorded anyway (`analysis.md`,
`aidw decide`, `aidw audit picks`); the page is never a source of truth and is not committed.

### When

- **Use a page** for a round of two or more questions, for any single question whose options have trade-offs
  worth comparing, for a look the user must see (design direction), and for every Approval Gate.
- **Ask in the chat** for one simple question (yes or no, a name, a confirmation) and for a follow-up to one answer.
  A question with options asked in the chat still shows a View, as a fenced block under the question (see "Every
  choice shows a View").
- **One question after a design, in the chat.** When a round would hold a single question, such as a System Design
  with no Design Question left open, ask it in the chat: a summary of two or three lines, the link to the Artifact,
  and a View of what it decides.
- The user can always answer in the chat instead. Take that answer; do not send them back to the page.

### The flow

1. Write the data to `.aidw/run/pages/<name>.yaml` with the Write tool (`<name>`: lowercase, digits, `-`; e.g.
   `discovery-1`, `stack`, `system-design`, `gate`). One file per round; a new round gets a new name.
2. `aidw page render <name>`. It checks the data, writes the page and prints its link. A problem names the field:
   fix the file and render again.
3. Tell the user **only** the link and one or two lines on what the page asks. Do not repeat the questions or the
   options in the chat. Then stop and wait.
4. The user pastes the copied text. Run `aidw page answers <name> --text "<the pasted text>"`.
   - `OK`: record the printed lines word for word where this kind of answer is recorded, and run every `NEXT:`
     command that applies.
   - `REFUSED`: ask the user about exactly the listed problems. Never fill in an answer for them.
5. A note beside an answer is part of the answer. When it changes the question (a new option, a constraint), settle
   it in the chat before going on.

### The data: questions

```yaml
layout: questions
title: Where the notes app runs
intro: Three decisions on hosting and data. The recommended answers are preselected.
lang: vi                      # the language you speak with the user: en | vi
role: software-architect      # shown on each question
questions:
  - id: Q1
    title: Where does the app run?
    body: The MVP has no background jobs yet.            # optional context
    example: A nightly export would need a scheduled job. # optional, one concrete case
    criteria: [Monthly cost, Ops work, Changing later]    # 2 to 4 rows every option answers, or none
    recommend: vercel
    why: One command to deploy and a preview per branch; nothing in the MVP needs a long-running process.
    options:
      - key: vercel
        name: Vercel
        summary: Managed hosting for Next.js.             # optional
        pros: [Preview per branch, No servers to patch]
        cons: [Long jobs must live elsewhere]
        facts: { Monthly cost: 0 to 20 USD, Ops work: almost none, Changing later: easy }
        view:                   # what this option adds to the repository
          kind: tree
          text: |
            notes/
            ├── app/
            └── vercel.json     # build and preview settings
      - key: vps
        name: Own VPS
        pros: [Full control, Fixed price]
        cons: ["You own security, backups and updates"]
        facts: { Monthly cost: 6 USD, Ops work: high, Changing later: hard }
        view:
          kind: tree
          text: |
            notes/
            ├── app/
            ├── Dockerfile
            ├── deploy/nginx.conf
            └── deploy/backup.sh  # yours to schedule and check
  - id: Q2
    title: Which sign-in methods?
    multi: true                 # several options may be chosen
    recommend: [email]
    why: The client asked for email only; Google can be added later without a migration.
    view:                       # one View for the whole question
      kind: diff
      text: |2
         <SignInPage>
           <EmailForm />
        +  <GoogleButton />     # only if you choose Google
    options:
      - { key: email, name: Email and password, summary: No third party }
      - { key: google, name: Google, summary: One click for most users }
  - id: Q3
    title: What do your users call a note today?
    suggest: Note               # an open question has no options; `suggest` is your recommended answer
    optional: true              # only when an empty answer is acceptable
```

Writing a good card:

- **Every choice shows a View** (next section), unless it is a yes or no or a name.

- **Every choice carries `recommend` and `why`.** The user should be able to accept the page as it stands.
- **`criteria` are what makes trade-offs visible.** Pick the two to four things that really differ between the
  options (cost, effort, risk, how hard it is to change later, what the user sees) and answer each one for every
  option in a few words. Use words and real figures ("about 20 USD a month", "hard"), never invented scores.
- `pros` and `cons` are what this option alone gives or costs, one short line each. Do not repeat the criteria.
- A technical option carries up to 4 `metrics` the Architect names (see "Metrics" below).
- Keep `key` a short slug; it is what comes back in the answer.
- A question that answers a Decision Point of the Workflow names it (`decision: research-needed`) and uses the
  Decision Point's own answers as its option keys; the checked answer then prints the `aidw decide` command.
- The scope round of a `product` change sets `kind: scope` and asks the questions `vision`, `scope`, `mvp` and `out`
  (`/aidw:start` step 2b); the checked answer says where it is recorded.
- Quote a list entry that contains a comma or a colon (`["Create, edit and delete", Search]`), or write the list
  one entry per line; an unquoted comma splits it in two.
- Text fields take `code` in backticks and `**bold**`; everything else is shown as written.

### Every choice shows a View

Options described only in words are hard to compare, so a question with options carries at least one **View**: the
smallest code shape that shows the point, picked as the vendored show-me skill says
(`aidw vendor-path humanlayer/show-me`). Put it on the question when one shape shows every option (the change, with
each option marked), or on each option when the options differ in shape.

```text
view: { kind: <kind>, text: <the block> }     # or a list of them
```

| kind | shows |
|---|---|
| `diff` | what changes in a shape that already exists: files, a call tree, components, steps. Lines start with `+`, `-` or a space; the page colours added and removed lines |
| `tree` | files and folders, with a short comment on what each holds |
| `calltree` | who calls whom at run time |
| `component` | UI structure, with the state and module boundaries that matter |
| `pseudocode` | logic or an algorithm, in a few plain lines |

- The text is shown exactly as written, in a monospace block, escaped: `<App>` stays text.
- Keep the indentation. Write the block with `|`; when its first line starts with a space (a diff's context line),
  write `|2` so YAML keeps that space.
- A screen, a look or a layout is shown with the `html` slot instead (a mock); it counts as the View.
- **`aidw page render` refuses** a question with options that has no `view` and no `html` on the question or on any
  of its options. Two kinds of question need none: a yes or no (exactly two options, keyed `yes` and `no`) and a
  name (`naming: true`, the options are names of a product or a term). An open question has no options and needs none.
- A gate section may carry a `view` too (its "agree" or "needs a change" is a yes or no, so the CLI does not ask for
  one): show the stack or the plan as a tree there when it says more than the points.
- **In the chat** the same rule holds. Put the View as a fenced block right under the question, with the options
  after it:

  ````text
  Where should sessions live? I recommend the database: one store to back up.

  ```diff
   login
     checkPassword
  -  saveSessionInMemory
  +  saveSessionRow      # db (recommended)
  +  saveSessionRedis    # redis
  ```

  db: in the database | redis: in Redis
  ````

### Each block picks a layout modelled on an example

The page's `layout` says what the user does: answer questions, pick items or agree with sections. A question or a
gate section may also say how it is drawn, with its own `layout`. Each one takes the shape of a vendored
html-effectiveness example (`aidw plugin-path library/vendor/anthropics/html-effectiveness/<file>`): its grid,
panels and badges, not its content or colours. Pages stay static: no script beyond the copy button, nothing loaded from the network.

| on | `layout` | example | draws | needs |
|---|---|---|---|---|
| question | `cards` (default) | | options side by side | |
| question | `approaches` | 01 | one numbered approach per row: its View, a Pro and Con table, its metrics as chips | options, each with a `view` or `html` |
| section | `text` (default) | | body, points, View | |
| section | `before-after` | 17 | two columns, Before and After | `before` and `after` lines |
| section | `plan` | 16 | up to 4 key `figures`, then `steps` on a timeline (`when`, `title`, `detail`, `tags`) | `steps`, each with `when` |
| section | `walkthrough` | 04 | numbered `steps` through the code (`at`, `title`, `detail`, a folded `view`; `hot: true` marks the one to read first, open) | `steps`, each with `at` |

```yaml
- id: Q1
  title: How is the search debounced?
  layout: approaches            # technical options compared by their code shape
  recommend: hook
  why: Reused in three places and easy to test.
  options:
    - key: hook
      name: useDebounce hook
      pros: [One import reused]
      cons: [One more file]
      view: { kind: tree, text: "src/\n  hooks/useDebounce.ts" }
      metrics:
        - { name: Bundle, value: +0.2 kb }
        - { name: Testability, value: high, why: a pure hook tested with fake timers }
```

```yaml
sections:
  - id: build-order
    title: Plan
    layout: plan
    figures: { Tasks: "12", Waves: "4" }
    steps:
      - { when: Wave 1, title: Schema and API, detail: Two tables., tags: [T01, T02] }
  - id: booking-path
    title: How a booking flows
    layout: walkthrough
    steps:
      - { at: app/book/page.tsx, title: The form posts the slot }
      - { at: "app/api/bookings/route.ts:12", title: The route checks the slot, hot: true, view: { kind: pseudocode, text: "if slot taken: 409" } }
```

- The section with the id `before-after` is drawn as `before-after` without asking. The one the CLI adds from
  `analysis.md` writes its lines as `**Before**: ...` and `**After**: ...` points; the page sorts them into the two
  columns. A hand-written one with only a `body` stays readable.
- `before`, `after`, `steps` and `figures` on a section whose layout does not draw them are refused, as is a layout
  that is not in the table; the problem names the field (`sections[path].steps[1]: at is missing`).
- A page-level `layout: approaches` (or `plan`, ...) is refused with where it belongs.

### Metrics are a figure when known, a level with why otherwise

D4: a technical option shows its code shape (its View) and up to 4 metrics the Architect names: the things the
options really differ on (bundle size, latency, files touched, testability, how hard to undo).

```yaml
metrics:                        # a list, at most 4 per option
  - { name: Latency, value: 120 ms }                              # a figure with its unit, only when measured or known
  - { name: Testability, value: medium, why: needs the component mounted }   # else low, medium or high, and why
```

- `value` is a figure with its unit (`120 ms`, `+0.2 kb`, `~20 USD`), one of `low`, `medium`, `high`, or `none`
  (nothing of it: `New dependencies: none`). A level must say `why`; a bare number (`3`) or another word (`good`,
  `n/a`) is refused. A metric that does not apply to an option is not a metric to name. Never invent a figure to
  look precise.
- Every option of the question names the same metrics (case does not matter), so the chips line up in the first
  option's order; a missing one is refused.
- Metrics show on any question's options; `approaches` is where they belong.

### The data: picks

```yaml
layout: picks
title: Which findings to fix
items:
  - { key: F-01, title: No authorization check before cancel, group: high, tag: security, detail: app/api/bookings/route.ts, recommend: true }
```

Items are grouped by `group` in the order they first appear. `aidw page audit` builds this page from the audit
report by itself.

### The data: gate

```yaml
layout: gate
title: Approve the notes app
intro: What will be built, and what it needs from you.
lang: vi
change: 2026-11-17-notes      # adds the Program Design, the Decision Points and the plan size as sections
sections:
  - id: scope
    title: Scope
    body: A single-user notes app with tags and search.
    points: ["Create, edit and delete notes", Search by text and tag, "Out: sharing, mobile app"]
  - id: risks
    title: Risks and assumptions
    points: ["Assumed: fewer than 10,000 notes per user"]
```

The user marks every section "agree" or "needs a change" with a note. One section per thing they could send back
on its own: scope, stack, design, quality, deploy and permissions, risks. Keep each section to what fits on a
screen; the Artifact holds the rest, so name its path in the body. When the review before the gate ended with findings
still open, the CLI puts them first as the section `open-findings`; do not write a section with that id. Above
everything, the CLI adds `before-after` from `## Before / After` of `analysis.md`, so the user reads what changes for
them before anything else; write a section with that id only to show it better (a mock in its `html`), and it still
goes first.
After your sections the CLI adds `program-design` from `program-design.md`: the file tree and the signatures as
Views, because the user approves the Program Design with the rest and code that differs from it is a Deviation.
Write a section with that id only to show it better; yours then replaces it.

### The free slot (`html`)

A question, an option, an item or a section may carry `html`: a fragment for what words cannot show, such as a
screen mock, a color and type sample, a diagram as inline SVG or a short code sample.

- Static HTML, CSS and SVG only. No `<script>`, no event handlers, no `<iframe>`, `<link>` or `<form>`, nothing
  loaded from the network (`http://`, `https://`, `//`); images as `data:` URIs. The CLI refuses anything else.
- The fragment is isolated: its CSS does not leak into the page and the page's CSS does not reach it, so style it
  completely, including its own background and text color.
- Keep it small (well under 60,000 characters) and use it only where it earns its place.
- Lay it out after the example that fits what it shows, as the html-pages skill says
  (`aidw vendor-path aidw/html-pages`); a mock of the product keeps the product's own tokens.

### Pages the CLI builds itself

- `aidw page audit [--lang vi]`: the audit findings as a pick list.
- `aidw page triage <task> [--lang vi]`: the decision an escalated task asks of the user, from its triage diagnosis.
- A session that may not write files passes the data on stdin: `aidw page render <name> --stdin`.
