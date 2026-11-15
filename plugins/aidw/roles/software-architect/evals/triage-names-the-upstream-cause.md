---
case: triage-names-the-upstream-cause
---
## Input

A triage brief for task T04, which used all 3 attempts. Two scenarios of its requirement contradict each other: one says a
cancelled appointment frees its slot at once, the other says the slot stays blocked for 24 hours. Each attempt made one scenario's
test pass and broke the other's. The checkpoint output shows the same pair of failing tests alternating. The brief ends with: "Write the answer to the file named
above with the Write tool: the first line is exactly `CAUSE: <one of implementation, environment, plan, spec, architecture>`, then the
diagnosis. Reply with only the first line."

## Criteria

- must write the file named in the brief with the first line exactly `CAUSE: spec`
- must quote the two scenarios and the alternating failing tests as the evidence
- must say what the user has to decide (which behavior is right) and recommend one
- must not answer `CAUSE: implementation`, and must not edit the spec, the plan or any project file
- must reply with only the first line
