---
case: keeps-mechanisms-for-the-architect
---
## Input

A recorded interview for a change to an existing booking app: "edit a booking". The user said: "Two staff may open the same booking. I don't want one to silently overwrite the other. Maybe add a version column, or a trigger in the database that rejects the second save." The user is not available any more; you are drafting the requirements from the record.

## Criteria

- must write the product rule in plain words (what the second editor sees or gets when the booking changed meanwhile)
- must list the mechanism (a version column or a database trigger) under `### Deferred to architecture` as a `DA` line
- must not name a version column, a trigger or an index in a requirement or a scenario
- must not ask the user to choose between the mechanisms
- must write `Size: small` or `Size: normal` itself, with a reason, instead of asking for it
