# The Slop Check is aidw's own, uses Impeccable's catalog, and is not a Guard

Status: accepted (2026-11-18)

The reviewer's rules said "taste is non-blocking", so a generic interface passed every Gate with a remark. We
decided that the signs of a generic generated interface block a Change when a machine can check them. The rules
come from Impeccable: its catalog of 62 rules and its craft floor are vendored word for word (Apache-2.0,
`library/vendor/impeccable/`). Its detector is not used. aidw writes its own detection for the rules it can
measure with certainty, in the code at the task checkpoint and on the rendered page in the `ui-ux` layer; the
`ui-ux-designer` checks the rest of the catalog by eye, as remarks.

The check has two parts, because a failure of use and a matter of taste need different owners:

- **Failures of use** (contrast, overflow, clipped text, a blank area when something fails) are a Guard
  (ADR-0006): every project, brownfield included, and never waived.
- **The Slop Check** (the catalog's `slop` rules, for example gradient text, nested cards, a colored side
  border) applies only to a Change whose design aidw authors (`design-needed: full-design`). A rule is lifted
  only by an exception written, with its reason, in the Design Direction the user approved at the Gate. An
  implementing Agent cannot waive one.

## Considered Options

- **Run Impeccable's detector, pinned to one version.** Rejected: a check that blocks a Change would depend on a
  package from outside, its detection is a compiled engine that cannot be read as rules, and whether it runs
  without a network was not established. The catalog gives the same rules without the dependency.
- **Write the rules from nothing.** Rejected: Impeccable's catalog is the most complete public one, and its
  licence allows the copy.
- **A Guard on every project.** Rejected: a brownfield project chose its own look; blocking its cards and
  gradients would put aidw's taste on a client's product.
- **Let the reviewer block on judgment.** Rejected: it differs from run to run and a fix task can loop on it.
- **No exceptions.** Rejected: a direction may want a gradient or a centered layout on purpose, and a ban with no
  exception makes every product look alike in a new way.

## Consequences

- Fewer than 62 rules block at first; the count grows as detection is written. A rule the code cannot detect is
  still a remark from the reviewer.
- A re-sync of the vendored catalog can add rules. A new rule blocks nothing until aidw writes its detection.
- `rules.md` of the `ui-ux-designer` changes: taste stays non-blocking, a failed Slop Check does not.
