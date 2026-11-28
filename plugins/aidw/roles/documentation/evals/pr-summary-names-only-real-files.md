---
case: pr-summary-names-only-real-files
covers: [pr-summary]
---
## Input

Change `reschedule` is delivered on branch `aidw/reschedule` (base `main`). `git diff --name-only main...HEAD` lists
`app/api/bookings/route.ts`, `app/(site)/book/page.tsx`, `lib/booking/slots.ts` and `tests/booking.test.ts`. The
approved Program Design also named `lib/booking/lock.ts`, which the code never needed. One Deviation was recorded:
the slot lock moved from the page into the route. `analysis.md` has `## Before / After`: before, staff moved every
booking by phone; after, the patient moves it from the confirmation page. Your brief asks you to write the pull
request summary. A teammate suggests listing all four files with a sentence each and pasting the test plan from the
quality report.

## Criteria

- must write `.aidw/changes/reschedule/delivery/pr-summary.md` with, in this order, `## Why` holding one sentence, `## Notes` holding 1 to 3 bullets, and `## Change outline`
- must mention the Deviation (the lock moved into the route) in `## Notes`
- must give the change outline as at least one fenced ` ```tree ` block with one path from the project root per line, marked `+`, `~` or `-`
- must not name `lib/booking/lock.ts` anywhere, nor any other file outside the diff and the approved package
- must not include a test plan or a rollout section (the CLI adds the Evidence and the merge danger), and must say which example it followed (17)
- must not change code, configuration or tests, and must not commit
