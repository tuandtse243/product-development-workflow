---
name: build-design-mock
description: Build the static Design Mock of one Design Direction at real size, look at it rendered, and fix what fails; after the user chooses, extend it to at most three screens.
---

# Build a Design Mock

You build one candidate the user will compare with two others, built by other Agents from other directions. You
see one direction only: do not open `.aidw/design/directions/` beyond the file your brief names, and do not open
another mock folder. A mock that drifts toward a familiar look loses the reason it exists.

Read first: your direction file, the product's requirements, and `aidw plugin-path
roles/ui-ux-designer/references/mock-files.md` (folder, file names, how tokens are written in CSS).

## Two modes

- **Candidate** (before the choice): the main screen only, in its working state.
- **Extend** (after the user chose this mock): add up to two screens, the secondary screen the requirements need
  most (often a form or a detail) and a landing page when the product has one, plus the empty and error states of
  the main screen. Never more than three screens; states do not count as screens.

## 1. Inventory the content

Before any markup, list what the screen shows, in three groups:

- **Real**: names, labels, rules and wording taken from the requirements.
- **Sample**: data you invent so the screen looks used (eight tasks, three members, a week of figures). Plausible,
  in the product's language, varied in length (one long title, one short), marked as sample in an HTML comment.
  No invented customers, testimonials, metrics presented as facts, or brand logos.
- **Absent**: what the requirements do not give. Leave it out rather than fake it.

Write the copy in the product's language. Controls say what they do ("Thêm việc", not "Gửi"); an error names the
problem and the way out.

## 2. The plan, at the top of `tokens.css`

Open `tokens.css` with a comment of six lines: the direction id, the world, the layout concept in one sentence,
the one bold thing, the Slop Check exceptions you use (from the direction only), and the screen's primary action.
This comment is the record a reviewer reads; keep it true as the mock changes.

## 3. Tokens and base

Write every color, face, size, radius, shadow and duration of the direction as a custom property in `tokens.css`,
light values on `:root`, dark values under `prefers-color-scheme: dark`, as `mock-files.md` shows. Components use
only these properties: a literal color in a component rule is a defect. Link the fonts the direction fetched from
`fonts/`; a face that is not there is fetched with `aidw mock font` into this folder before use, never replaced by
a system font.

Style the parts nobody draws: text selection, the caret, focus rings, scrollbars, underline offset, and tabular
figures wherever numbers line up.

## 4. First region first

Build the region the eye lands on first (the header and the top of the list, the hero of a landing page) and stop.
Take the screenshots (step 6) and look at them as if someone else had made them: does this read as the direction's
world, or as a generic screen with its colors? Fix the first region before building the rest: what is wrong there
is wrong everywhere.

## 5. The rest of the screen

Complete the screen with the direction's treatment for its Screen Kind. Keep these whatever the direction says:

- Real size: designed for 1440 px wide and for 390 px wide; at the phone width it reflows, it does not shrink.
- One primary action per screen, the most prominent control on it.
- Visible keyboard focus, labels on every field, targets at least 44 px on the phone.
- Motion respects `prefers-reduced-motion`, and every element is visible at rest before any animation runs.
- No script except what an effect strictly needs; no request to another host. Everything the mock uses is in its
  folder.

## 6. Look at it rendered

Follow `aidw plugin-path roles/ui-ux-designer/references/render-check.md`: shoot the folder, open every screenshot
with Read, and go through the checks in their order. Fix what fails, shoot again, look again. Two rounds of fixes at
most; what still fails after the second goes into your report as it is.

Never report a check you did not do on a screenshot. A pass you did not see is worse than a failure you name.

## Done when

The folder holds the screens of your mode in both themes, the screenshots of the last round, `CREDITS.md` for every
image, and a `tokens.css` whose top comment matches the screen. Reply with:

```
MOCK: <folder>
Direction: <id>, world: <world>
Screens: <file>: <what it shows>
Checks: floor <pass | n failing>, slop <pass | n failing>, finish remarks <n>
Failing: <check>: <screen, viewport, theme>: <what is wrong>
Assumed: <every assumption about the subject or the content>
```

## Stop and report when

- `aidw mock shots` says the test browser is not running: report the command to start it and stop; never judge a
  mock you could not see.
- The direction is missing a section you need (no dark values, no type scale): say which, do not invent it.
- The requirements do not say what the main screen is for.

## Sources

Ideas, not wording: Hallmark (nutlope/hallmark, MIT): inventory of real, sample and absent content, the plan as a
comment at the top of the CSS, building and judging the first region before the rest, checks in tiers on the
rendered page, and the rule that a pass not seen is a failure. Anthropic `frontend-design`: one bold place, a type
scale with intent, real copy written from the user's side. Impeccable's craft floor (vendored): the checks on the
built result and the browser surfaces.
