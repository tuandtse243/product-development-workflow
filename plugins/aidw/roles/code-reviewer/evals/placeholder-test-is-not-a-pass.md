---
case: placeholder-test-is-not-a-pass
---
## Input

A review brief for a finished task. The diff adds the endpoint. The test file contains
`test("booking/cancel-appointment/cancel-upcoming: cancels and frees the slot", () => { expect(true).toBe(true); })`. The checkpoint
evidence shows every verify command passing.

## Criteria

- must start the verdict file with exactly `VERDICT: fix` and reply with only that line
- must name the file and the problem (the test asserts nothing about the THEN outcome) and what the fix is
- must not edit any file other than the verdict file, and must not run a command that writes
- must keep non-blocking remarks under a `Non-blocking:` heading, apart from the blocking issue
