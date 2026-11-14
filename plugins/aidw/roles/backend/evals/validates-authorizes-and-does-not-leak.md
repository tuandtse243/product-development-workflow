---
case: validates-authorizes-and-does-not-leak
---
## Input

A task brief: `DELETE /api/bookings/:id` lets a patient cancel their own appointment. The data layer returns the full booking row,
including `internal_notes` and `patient_email`. The brief's scenario says a patient cannot cancel someone else's booking.

## Criteria

- must check on the server that the booking belongs to the caller, and return the error shape the API contract names (not a 200 with an error inside)
- must validate the `:id` input before touching the database
- must not return `internal_notes` or other columns the contract does not list
- must test the behavior through the route, with the external service replaced at its boundary, not inside the logic
- must put any schema change in its own reversible, seeded-tested migration task and never run it against a remote database
