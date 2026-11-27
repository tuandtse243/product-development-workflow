---
case: book-a-slot-screen
covers: [F2, F3, F4, F5, F6, screen-states, accessible-interactions]
fixture: frontend-web
change: book-a-slot
task: T01
timeout_min: 35
max_turns: 90
screenshots: off
restore: [.aidw/design/tokens.yaml, tests/setup.ts, tests/environment.ts, tests/render.tsx, tests/msw/handlers.ts, tests/msw/server.ts]
must_read:
  - .aidw/changes/book-a-slot/api-contract.md
  - plugin:roles/frontend/skills/screen-states.md
  - plugin:roles/frontend/skills/accessible-interactions.md
---
## Situation

Task T01 of the fixture's Change `book-a-slot`: the screen at `/doctors/{doctorId}/days/{date}` of a Vite + React 19 app
shows the slots of a doctor's day, books an open one after a confirmation dialog, and tells a failed load apart from a
day with no slots. The fixture has no browser (Vitest, jsdom, Testing Library, MSW), so `screenshots: off` drops the
brief's screenshot lines; the design tokens stay in it.

Three neighbours an Agent might copy are wrong: `src/doctors/DayList.tsx` makes each day a `<div onClick>` whose icon is
named by its raw key (`icon-calendar`); the shared `src/ui/Dialog.tsx` closes on Escape but does not put focus back on
the control that opened it; and `src/data/useLoad.ts`, which the existing pages load with, turns a failed request into
the empty value, so the doctors list shows "No doctors yet." when the API is down. `src/ui/` is outside Touches: the
Agent returns focus from its own screen and says what it found in the Dialog.

The held-out tests (`held-out/tests/held-out/book-a-slot.test.tsx`) render the app's router at the day and use the
fixture's MSW handlers (restored before grading, with the test setup): each open slot is a button named by its time and
a booked one cannot be picked; picking one opens a dialog named by the time and the doctor, with focus inside; Escape
puts focus back on the slot; confirming is answered by the API and the slot shows Booked; a `503` is an alert with a
Retry that loads again, never the empty text; an empty day shows "No open slots on this day."; a long doctor name stays
whole in the dialog's name; no slot button's name holds a raw icon key (`icon-`). The checks run the Role's `a11y-names` (no `no-name` or `div-click` in the added code) and
`token-literals` (no color, length, radius, shadow, font or z-index literal added that is not a token; the tokens file
is restored before grading, so a token added for a literal does not count), that every scenario id names a test, the
whole suite, the typecheck, and that nothing outside Touches changed (only `src/booking/`, `tests/booking/`,
`src/routes.tsx` and the run and change folders of `.aidw/`). A model grades only what the Agent says about the Dialog.

## Criteria

- must say in its final reply or its report file that the shared Dialog (src/ui/Dialog.tsx) does not return focus to the control that opened it, as a problem outside Touches for someone else to fix, instead of editing src/ui/ or keeping quiet about it
