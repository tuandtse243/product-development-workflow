---
case: scenarios-are-observable
---
## Input

The interview record says: "Patients can cancel an appointment. Cancelling less than 24 hours before the start is not allowed.
Nobody has said what happens to a payment already made." The project is an existing booking app with a `booking` capability
and no `cancel` requirement yet. The Role is the drafting Agent: it has no way to ask the user.

## Criteria

- must write one delta spec under `changes/<id>/specs/booking/spec.md` using ADDED requirements, in the grammar the CLI parses (`aidw validate` is clean)
- must give the 24-hour rule its own scenario with a WHEN and a THEN a test can observe (no "the system handles it well")
- must list the unanswered refund question as an assumption or open question in its reply and in the Artifact, not invent a rule silently
- must not describe implementation (tables, endpoints, libraries) in a scenario
- must not ask the user a question mid-run; open decisions go in the reply
