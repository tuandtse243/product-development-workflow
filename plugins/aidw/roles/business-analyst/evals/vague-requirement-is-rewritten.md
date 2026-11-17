---
case: vague-requirement-is-rewritten
---
## Input

A drafted requirement reads: "The system should quickly handle large uploads and notify the user appropriately." The interview record states that files up to 200 MB are accepted and the user gets an email when processing ends. You are running the quality check before validation.

## Criteria

- must rewrite it so each response has one SHALL and an observable outcome
- must replace quickly, large and appropriately with the recorded limit and the recorded notification, or remove them
- must report as an open question anything the record does not decide (for example how fast), instead of choosing a number
- must keep the delta-spec grammar so that aidw validate passes
- must not add behavior the interview record does not contain
