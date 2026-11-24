## Decision Pages: how the user is asked to choose

A wall of options in the terminal is hard to compare. So a round of questions, a pick list and an Approval Gate
summary are shown as a **Decision Page**: one HTML file the user opens, with the options side by side. The page is
a view. What the user chooses comes back as text and is recorded where it is recorded anyway (`analysis.md`,
`aidw decide`, `aidw audit picks`); the page is never a source of truth and is not committed.

### When

- **Use a page** for a round of two or more questions, for any single question whose options have trade-offs
  worth comparing, for a look the user must see (design direction), and for every Approval Gate.
- **Ask in the chat** for one simple question (yes or no, a name, a confirmation) and for a follow-up to one answer.
- The user can always answer in the chat instead. Take that answer; do not send them back to the page.

### The flow

1. Write the data to `.aidw/run/pages/<name>.yaml` with the Write tool (`<name>`: lowercase, digits, `-`; e.g.
   `discovery-1`, `stack`, `gate`). One file per round; a new round gets a new name.
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
      - key: vps
        name: Own VPS
        pros: [Full control, Fixed price]
        cons: ["You own security, backups and updates"]
        facts: { Monthly cost: 6 USD, Ops work: high, Changing later: hard }
  - id: Q2
    title: Which sign-in methods?
    multi: true                 # several options may be chosen
    recommend: [email]
    why: The client asked for email only; Google can be added later without a migration.
    options:
      - { key: email, name: Email and password, summary: No third party }
      - { key: google, name: Google, summary: One click for most users }
  - id: Q3
    title: What do your users call a note today?
    suggest: Note               # an open question has no options; `suggest` is your recommended answer
    optional: true              # only when an empty answer is acceptable
```

Writing a good card:

- **Every choice carries `recommend` and `why`.** The user should be able to accept the page as it stands.
- **`criteria` are what makes trade-offs visible.** Pick the two to four things that really differ between the
  options (cost, effort, risk, how hard it is to change later, what the user sees) and answer each one for every
  option in a few words. Use words and real figures ("about 20 USD a month", "hard"), never invented scores.
- `pros` and `cons` are what this option alone gives or costs, one short line each. Do not repeat the criteria.
- Keep `key` a short slug; it is what comes back in the answer.
- A question that answers a Decision Point of the Workflow names it (`decision: research-needed`) and uses the
  Decision Point's own answers as its option keys; the checked answer then prints the `aidw decide` command.
- The scope round of a `product` change sets `kind: scope` and asks the questions `vision`, `scope`, `mvp` and `out`
  (`/aidw:start` step 2b); the checked answer says where it is recorded.
- Quote a list entry that contains a comma or a colon (`["Create, edit and delete", Search]`), or write the list
  one entry per line; an unquoted comma splits it in two.
- Text fields take `code` in backticks and `**bold**`; everything else is shown as written.

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
change: 2026-11-17-notes      # adds the Decision Points and the plan size as sections
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
screen; the Artifact holds the rest, so name its path in the body.

### The free slot (`html`)

A question, an option, an item or a section may carry `html`: a fragment for what words cannot show, such as a
screen mock, a color and type sample, a diagram as inline SVG or a short code sample.

- Static HTML, CSS and SVG only. No `<script>`, no event handlers, no `<iframe>`, `<link>` or `<form>`, nothing
  loaded from the network (`http://`, `https://`, `//`); images as `data:` URIs. The CLI refuses anything else.
- The fragment is isolated: its CSS does not leak into the page and the page's CSS does not reach it, so style it
  completely, including its own background and text color.
- Keep it small (well under 60,000 characters) and use it only where it earns its place.

### Pages the CLI builds itself

- `aidw page audit [--lang vi]`: the audit findings as a pick list.
- `aidw page triage <task> [--lang vi]`: the decision an escalated task asks of the user, from its triage diagnosis.
- A session that may not write files passes the data on stdin: `aidw page render <name> --stdin`.
