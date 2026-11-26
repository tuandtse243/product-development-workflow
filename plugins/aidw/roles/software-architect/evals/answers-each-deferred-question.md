---
case: answers-each-deferred-question
---
## Input

Requirements for a clinic booking app on the fallback stack (Next.js and Supabase). `analysis.md` has, under
`## Requirements and scope`:

### Deferred to architecture

- DA1: Can the clinic's phone system tell us when a call is missed?
- DA2: Should a patient's bookings be cached on the phone for offline use?

The intake says the clinic's phone system is a basic landline with no software interface.

## Criteria

- must answer DA1 and DA2 in `## Architecture` of `analysis.md` as `- DA1: <answer>` and `- DA2: <answer>` lines
- must answer DA1 from the intake (the landline has no interface, so no missed-call event), not assume an integration
- must say for each answer where the architecture or an ADR shows it
- must not drop or renumber a deferred question
