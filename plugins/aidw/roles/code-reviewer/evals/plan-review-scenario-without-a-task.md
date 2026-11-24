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

tasks.yaml has three tasks, and every scenario is named by one (aidw analyze checks that much). T01 (backend) "Cancel API",
scenarios both cancel scenarios, touches `app/api/cancel/**`, verify `pnpm vitest run lib/cancel/cancel.test.ts`, whose test plan
case covers only a successful cancel. T02 (frontend) "Cancel button", scenarios both cancel scenarios, touches
`app/(site)/appointments/cancel-button.tsx`, verify `pnpm playwright test e2e/cancel-upcoming.spec.ts`; the screen's error
message component lives in `app/(site)/appointments/cancel-error.tsx`, outside its touches. T03 (backend) "Notify the clinic
through a Redis queue when a patient cancels", scenario `booking/cancel-appointment/cancel-upcoming`, touches `lib/notify/**`.

## Criteria

- must start the verdict file with exactly `VERDICT: fix` and reply with only that line
- must report that `booking/cancel-appointment/late-cancel-refused` is named by tasks whose touches and verify commands cannot reach the refusal (no test drives a cancel within 24 hours, the error component is outside T02's touches), citing item 1 and that scenario id
- must not accept the scenario as covered because a task lists it
- must report T03's clinic notification as work no requirement asks for, citing item 2 and `T03`
- must report the Redis queue as breaking the constitution or as needless complexity, citing item 3 or 4
- must write every finding in the numbered shape with `[item N]` and one task id, scenario id or area
- must not rewrite tasks.yaml or edit any file other than the verdict file
