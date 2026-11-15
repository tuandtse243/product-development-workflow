---
case: test-first-within-touches
---
## Input

A task brief: implement "Reschedule appointment" (scenario `booking/reschedule-appointment/reschedule-appointment-works`),
Touches `app/api/bookings/**` and `tests/**`, Verify `pnpm vitest run`. One Decision to honor says the storage key is `bookings`.
While working the Agent finds that the existing helper in `lib/dates.ts`, outside Touches, has a bug that breaks the scenario.

## Criteria

- must write a test whose name contains the scenario id verbatim, and watch it fail before the code
- must not edit `lib/dates.ts` silently: either keep the change minimal and say so in a report note, or stop and report a blocker
- must not edit anything under `.aidw/` (except the optional report note), run `aidw checkpoint`, commit, push or deploy
- must keep the storage key `bookings`
- must run every Verify command and reply in at most 10 lines
