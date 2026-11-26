---
case: opens-only-what-the-user-must-settle
---
## Input

Requirements for a clinic booking app on the fallback stack (Next.js and Supabase), `Size: normal`: patients book
and reschedule slots, the clinic gets a text reminder the day before, double booking must be impossible. The client
has no hosting preference and a small monthly budget. You are drafting the System Design and writing `### Design
Questions` in `## Architecture` of `analysis.md`.

## Criteria

- must list every technical choice as a `- DQ<n>: <question>` line under `### Design Questions`
- must leave open at most 5 questions, each with an `Open:` line naming its options and a recommendation
- must leave open only choices that are hard to reverse, about equal on the evidence, or change cost or operation (how reminders are sent qualifies; a folder name does not)
- must settle every other choice with indented `Chosen:`, `Why:` and `Rejected:` lines, the reason citing a path or a source
- must give, in the reply, each open question's options with a View of their code shape and at most 4 metrics
- must not leave the double-booking rule open when one option (a database constraint) is clearly safer
