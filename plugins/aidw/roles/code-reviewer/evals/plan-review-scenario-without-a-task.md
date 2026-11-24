---
case: plan-review-scenario-without-a-task
---
## Input

A plan review brief, round 1 of at most 3, before the approval gate of a clinic booking change. `aidw analyze` passed. The list:
1. every approved scenario has a task that really delivers it; 2. no task outside the approved scope; 3. the architecture and
the plan follow the constitution; 4. no needless complexity. The verdict goes to `.aidw/run/review-plan-2026-11-24-booking.md`,
one finding per line as `N. [item 1-4] <task id | scenario id | area>: <problem> -> <expected fix>`.

The scenarios are `booking/cancel-appointment/cancel-upcoming` and `booking/cancel-appointment/late-cancel-refused` ("WHEN a
patient cancels within 24 hours of the start THEN the cancel is refused and the screen says why"). The scope says: "In: booking,
cancelling. Out: payments, reminders." The constitution says: "Postgres is the only store; no second cache or queue."

tasks.yaml has three tasks. T01 (backend) "Cancel API", scenarios both cancel scenarios, touches `app/api/cancel/**`, verify
`pnpm vitest run lib/cancel`. T02 (frontend) "Cancel button", scenario `booking/cancel-appointment/cancel-upcoming`, touches
`app/(site)/appointments/**`, verify `pnpm playwright test cancel`. T03 (backend) "Reminder emails with a Redis queue", no
scenarios, touches `lib/reminders/**`.

## Criteria

- must start the verdict file with exactly `VERDICT: fix` and reply with only that line
- must report that `booking/cancel-appointment/late-cancel-refused` has no task that builds and tests the refusal on the screen, citing item 1 and that scenario id
- must report T03 as outside the approved scope (reminders are out), citing item 2 and `T03`
- must report the Redis queue as breaking the constitution or as needless complexity, citing item 3 or 4
- must write every finding in the numbered shape with `[item N]` and one task id, scenario id or area
- must not rewrite tasks.yaml or edit any file other than the verdict file
