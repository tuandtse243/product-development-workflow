---
name: html-pages
description: Build an HTML page a user or client reads - a comparison, a walkthrough of code, a plan, a before and after, a report - modelled on one of the 20 vendored html-effectiveness examples and kept inside aidw's page rules.
---

# HTML pages

Every HTML page the user sees speaks one visual language, whoever builds it: the CLI (`aidw page render`, from page
data) or an Agent (the `html` slot of a Decision Page, the page of an Existing System Report, the pull request
write-up). Both are modelled on the same 20 example pages, vendored word for word from anthropics/html-effectiveness
(ADR-0017). Read the example you pick before you write:
`aidw plugin-path library/vendor/anthropics/html-effectiveness/<file>.html`.

The examples are shapes, not templates. Take their layout and components; never their content, their labels, the
"Acme" brand, their prompts or their colours.

## Pick the example by the kind of page

| Example | Kind of page | Take | Leave |
|---|---|---|---|
| 01 | Two to four technical approaches to one Design Question; the CLI layout `approaches` | One column per option: a one-line summary, its code shape, a pro and con table, up to four metric chips; the recommendation in its own panel after the columns | Hand-coloured syntax spans where a plain monospace block reads as well; a fifth chip |
| 02 | Looks side by side: Design Directions, an empty state in three treatments | Artboards of the same size in a row, a tag and two lines of rationale under each | The light and dark toggle (a script); its colours, since each artboard uses its direction's own tokens |
| 03 | Review findings over a diff | A risk map that tags each file safe, worth a look or needs attention; the changed lines with line numbers; next steps | Avatars and branch chrome; the collapsing script |
| 04 | How code works today: the page of an Existing System Report, one call path; the CLI layout `walkthrough` | A lede that names the one boundary that matters, a small SVG of the path, numbered steps each with `path:start-end` and its source in `<details>`, Key files, Gotchas | The script that keeps one snippet open; any step without a file and line |
| 05 | The tokens of an approved Design Direction | Swatches with name and hex, type specimens with size and weight, spacing bars, radius and shadow samples | Its palette: tokens come from `.aidw/design/` |
| 06 | Variants of one component | The same card in each treatment, labelled, with "best for" under each | The density controls and the hover-to-reveal code (both scripts) |
| 07 | A motion to approve | The keyframes as a static timeline with times, the easing named, the CSS to copy | The playable demo: motion is judged in the running product |
| 08 | How an interaction should feel | A static mock with the "what you're feeling" notes beside it and the open questions under it | The drag-and-drop prototype itself |
| 09 | A short summary a client reads in five minutes | One point per section, a big number with its change, one section for the decision asked | Keyboard navigation and full-screen slides: on an aidw page the slides are sections that scroll |
| 10 | A drawing that explains a mechanism: a queue, a retry, a fan-out | Inline SVG with few colours, 1.5 to 2 px strokes, mono labels inside boxes, a caption under each | The download buttons and the outside links |
| 11 | Progress of a run or a delivery | Stat cards with a change since last time, a table of what shipped, carried-over items each with its reason | Authors and links aidw does not have |
| 12 | Something that went wrong: a task not built, a failed deploy, a triage | The short answer first, a timeline with times, the root cause with the lines that caused it, impact, action items | A severity or status the evidence does not state |
| 13 | A Workflow or pipeline: stages, decision points, where it stops | An SVG flowchart with a legend (step, decision, end, failure path) and numbered notes under it | Click a step to read about it: put the notes in a list keyed by the step's number |
| 14 | How one feature works, for someone who will use or change it | The short answer, the path step by step with `path:line`, how to configure it, gotchas, a FAQ, the files read | Tabs (a script): stack the panels or put each in `<details>` |
| 15 | A concept a client must grasp before choosing | The question first, one figure, the same figure before and after, where the reader will meet it | The interactive ring: draw two static states instead |
| 16 | A plan: the gate's plan section, the tasks of a Change; the CLI layout `plan` | Headline cells (tasks, Waves, new tables), numbered sections, milestones with what each touches, the data flow, risks with their mitigation, open questions | Calendar dates when the plan has Waves; the outside link |
| 17 | The pull request write-up and any before and after; the CLI layout `before-after` | The short answer, Why with Before and After panels, file by file with a new or changed badge and the reason in `<details>`, where to focus the review, the test plan, the rollout | The author line; files that do not matter to the reviewer |
| 18, 19, 20 | A page where the user edits: sorts, toggles, tunes | Only the idea: show a best guess first and let the choice come back as text | Building an editor: a choice goes on a Decision Page (`questions` or `picks`), whose answers the CLI checks |

Two kinds fit two examples. A comparison of code takes 01; a comparison of looks takes 02. A walkthrough for the
person who will change the code takes 04; an explanation for someone who will use the feature takes 14.

## Use a CLI layout before writing HTML

When a CLI layout fits, write its page data and run `aidw page render <name>`: the CLI already follows the matching
example, escapes the text and checks the rules (`aidw plugin-path library/decision-pages.md` gives each layout's
data). The layouts `questions`, `picks` and `gate` hold rounds, pick lists and the Approval Gate; `approaches` (01),
`walkthrough` (04), `plan` (16) and `before-after` (17) hold the four pages above. Write HTML yourself only for an
`html` slot or for a page no layout covers.

## Every page follows the page rules

The page rules live in `decision-pages.md` ("The free slot"). Where an example differs from them, the page rules win.

- **Static.** HTML, CSS and inline SVG only: no `<script>`, no event handlers, no `<iframe>`, `<link>` or `<form>`.
  Most examples carry a script; replace what it does. A toggle becomes `<details>` and `<summary>`, tabs become
  stacked sections, a slider becomes two static figures, a click-to-inspect diagram gets numbered notes.
- **Nothing from the network.** No `http://`, `https://` or `//` anywhere, so no web fonts and no CDN; images are
  `data:` URIs. Fonts are the system stacks: `system-ui` for text, `ui-monospace` for code and paths.
- **Escape every text you put in.** `<`, `>` and `&` in code, names and quotes become `&lt;`, `&gt;` and `&amp;`, so
  `<App>` stays text. Code goes in `<pre>`, escaped, with its indentation kept.
- **One palette, light and dark.** Use the aidw pages' colours so the CLI's pages and yours look alike: background
  `#f3f5f9`, surface white, text `#17202e`, muted `#5b6678`, lines `#d6dce6`, accent `#2f55d4`, added `#17794a` on
  `#dff3e8`, removed or at risk `#a8442a`. Under `@media (prefers-color-scheme: dark)`: background `#11151c`, surface
  `#1a202a`, text `#e7ebf2`, muted `#9aa5b8`, lines `#2e3746`, accent `#8aa4ff`. A mock of the product is the
  exception: it uses the product's approved tokens, since it shows the product, not aidw.
- **An `html` slot is a fragment.** It is isolated from the page, so style it completely, its own background and
  text colour included, and keep it well under 60,000 characters. A whole page starts with `<!doctype html>`, a
  `<meta charset>` and a viewport line.
- **Phone width.** One column below about 700 px; only a code block may scroll sideways.
- **Real content.** Real paths with lines, real figures, the user's language (`lang`). A figure you do not know is
  written low, medium or high with why, never invented.

## The View comes from show-me

A question or an option on any page carries a View: the smallest diff, file tree, call tree, component tree,
pseudocode or mock that shows the point, picked as `aidw vendor-path humanlayer/show-me` says (read its notes in
`library/vendored-skill-notes.md`). On a Decision Page the View goes into the `view:` field and the CLI draws it. In
HTML you write, a View is an escaped `<pre>` block; in a diff colour the added lines with the added colours and the
removed lines with the removed ones. Mermaid needs a script to draw: write the same flow as a call tree or as SVG.

## Markdown laid out after an example

A Markdown write-up that follows an example, such as the pull request summary after 17, takes the order of its
sections and the components Markdown can hold: Before and After as two short blocks, file by file as a list with the
reason for each, Views as fenced blocks. Colours and panels stay on HTML pages.

## Hand the page over as a link

Write the file where your brief or the Workflow says. Never open it yourself; give its path or link with one or two
lines on what it shows, and stop.

## Right and wrong

Right, a walkthrough after 04: "Sessions live only in `src/lib/sessionStore.ts`", then four numbered steps, each
`src/middleware/auth.ts:14-31` with the escaped source in `<details>`, and Key files and Gotchas under them. No
script; it reads the same with the network off.

Wrong: 04 copied whole, its script kept for the snippets, the clay and ivory colours, "acme/web" in the eyebrow, a
web font from a CDN, and `<SessionPage>` pasted unescaped so the browser swallows it.

## Sources

Ideas, not wording: anthropics/html-effectiveness (MIT, github.com/anthropics/html-effectiveness), the 20 example
pages and the README's grouping of them (exploration, code, prototyping, communication, diagrams and research,
editing UIs); HumanLayer `show-me` (MIT, github.com/humanlayer/skills, `plugins/show-me`) and the `rpi` reference
`create-design-discussion` (the smallest view that makes the point, a focused HTML page for what a diagram cannot
show, real labels, a link instead of a wall of text).
