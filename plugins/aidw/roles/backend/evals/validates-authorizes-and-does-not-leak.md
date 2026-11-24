---
case: validates-authorizes-and-does-not-leak
covers: [B2, B5, endpoint-test-matrix]
---
## Input

A task brief: `DELETE /api/bookings/:id` lets a patient cancel their own appointment. The data layer returns the full booking row,
including `internal_notes` and `patient_email`. The brief's scenario says a patient cannot cancel someone else's booking.

## Criteria

- must check on the server that the booking belongs to the caller, and return the error shape the API contract names (not a 200 with an error inside)
- must validate the `:id` input before touching the database
- must not return `internal_notes` or other columns the contract does not list
- must test through the route the three access cases: no caller identity, another patient's booking (refused, and the booking stays active), and the owner's own booking (cancelled)
- must not write a migration or schema file; a column or constraint the work would need is asked of `database-architect`, never written in this task
