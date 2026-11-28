---
case: not-everything-is-a-unit-test
---
## Input

Delta specs for a booking capability with four scenarios: `booking/cancel-appointment/cancel-early` (WHEN a patient cancels 24 hours or more before the appointment THEN it is cancelled and the slot is free); `booking/cancel-appointment/late-cancel-refused` (WHEN a patient cancels less than 24 hours before the appointment THEN the cancellation is refused and the booking stays); `booking/book-slot/last-slot-once` (WHEN two patients book the last slot at the same moment THEN exactly one booking exists); `booking/cancel-appointment/cancel-confirmation` (WHEN a patient clicks Cancel on the appointment page THEN they see a confirmation). The stack is Next.js with Postgres. You are writing the test plan and quality.yaml.

## Criteria

- must give the 24-hour rule boundary cases (just over, exactly, just under) at the unit layer, each with its expected outcome (cancelled, cancelled, refused)
- must place the concurrent-booking scenario at a layer that uses a real database, not a mock
- must place the click scenario at a layer that performs the user action (e2e or a component test)
- must list every scenario id verbatim in the test plan with at least one case
- must not report any test result, and must not write test code or application files (`test-plan.md` and `quality.yaml` are the Role's own files)
