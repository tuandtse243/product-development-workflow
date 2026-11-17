---
name: deployment-checklist
description: Prepare what a production deployment needs - the ordered steps, the checks, the way back, and the evidence - for the user to decide and run.
---

# Deployment checklist and rollback

A production deployment is the user's decision and the user's action. You prepare it so that the decision is
informed and the steps are safe to follow. You never run it.

## 1. What this release changes outside the code

Read the diff of the Change for:

- **database migrations**: each one, whether it can be reversed, whether it is safe while the old code still runs
  (expand before contract), how long it may take on the stated data size, and the point after which going back
  loses data;
- **configuration**: new, changed or removed environment variables (names and where each value comes from, never
  a value), feature flags, scheduled jobs, queues, webhooks to register, DNS or domain changes;
- **dependencies on the outside**: a provider plan or quota, an API version, a credential with a new scope;
- **order**: what must exist before what (the variable before the code that reads it; the column before the
  code that writes it).

## 2. The checklist, in order

**Before**: every quality layer passed on this commit (link the report); a backup or a restore point exists and
its age is known; the migrations were run against a copy or a preview; the variables are set in the target
environment; someone is watching and knows the rollback.

**Deploy**: the exact commands or the pipeline to trigger, in order; run migrations in the order the plan gives;
where there are steps to take between two deployments (expand, deploy, contract), say so and stop between them.

**After**: the smoke checks to run and what each must return; what to look at for the first minutes (error rate,
the key flow working end to end, the job queue); when to call it done.

## 3. The way back

For each step: how to undo it, how long that takes, and what is lost. Be honest about what cannot be undone:

- code: redeploy the previous version (name it);
- an additive migration: usually leave it; the old code ignores it;
- a destructive migration (a drop, a type change, a rewrite): cannot be undone without the backup. Say so in the
  first line of the checklist and require a verified backup before it;
- data written by the new version that the old version cannot read: say what happens to it.

State the trigger for rolling back in advance (a smoke check fails; errors above a named level for a named time),
so the decision is not made in the middle of an incident.

## 4. What the user needs in order to say yes

One screen: what ships, the risk that deserves attention, the evidence (layers, what was not covered), the
irreversible steps, the rollback, and what you could not verify from here.

## Output

`changes/<id>/release.md`, sections `## Deployment checklist`, `## Rollback` and `## Decision summary`.

## Sources

Ideas, not wording: Addy Osmani's `shipping-and-launch` (vendored: the pre-launch checklist and staged rollout),
Google's SRE book on release engineering and on having a rollback before you need it, and the expand-and-contract
practice for migrations.
