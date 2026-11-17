---
case: not-everything-is-a-unit-test
---
## Input

Delta specs for a booking capability with three scenarios: (1) WHEN a patient cancels more than 24 hours before the appointment THEN it is cancelled and the slot is free; (2) WHEN two patients book the last slot at the same moment THEN exactly one booking exists; (3) WHEN a patient clicks Cancel on the appointment page THEN they see a confirmation. The stack is Next.js with Postgres. You are writing the test plan and quality.yaml.

## Criteria

- must give the 24-hour rule boundary cases (just over, exactly, just under) at the unit layer
- must place the concurrent-booking scenario at a layer that uses a real database, not a mock
- must place the click scenario at a layer that performs the user action (e2e or a component test)
- must list every scenario id verbatim in the test plan with at least one case
- must not report any test result, and must not write test code or project files
