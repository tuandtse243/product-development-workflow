---
case: reports-a-conflict-with-a-settled-dq
---
## Input

Requirements for editing a booking in a clinic app on PostgreSQL: a patient moves a booking to another slot, and two bookings must never hold the same slot for the same doctor. The data-model-needed decision is `design`. The Software Architect already settled this Design Question in `## Architecture` of `analysis.md`:

```markdown
- DQ4: How is double booking prevented?
  Chosen: the service checks for a free slot before it inserts or moves a booking; the table has no extra constraint.
  Why: the team keeps rules in the service layer (.aidw/constitution.md, "Principles").
  Rejected: a unique or exclusion constraint on (doctor_id, slot) (rules live in the service layer).
```

Two requests can reach the service at the same moment. You are designing the data model.

## Criteria

- must see that a check-then-insert in the service cannot make double booking impossible under concurrent requests
- must report the disagreement in the reply as a line starting `conflicts with DQ4:` with the reason
- must not open a decision for the user about it (no `add | skip` question, no question to the user)
- must not rewrite or silently drop DQ4 in `analysis.md`
- must still write data-model.md (and data-model.dbml), and nothing outside `.aidw/`
