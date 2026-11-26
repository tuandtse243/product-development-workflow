# Usability Rules carry a fixed severity on every project, and Dark Patterns are not built

Status: accepted (2026-11-18)

Knowledge about use reached a Change only at its two ends: the usability requirements and the last review, where
the reviewer judged each case alone. The well-known principles (Nielsen's heuristics, Shneiderman's rules, most
"laws of UX") classify a problem; they do not say pass or fail, and most of their published wording may not be
copied. So aidw writes its own **Usability Rules**: about a hundred, in its own words, each naming its source
(WCAG 2.2, GOV.UK Design System, NN/g, Baymard, web.dev, Vercel) and carrying a severity fixed in advance:

- **blocking**: the job cannot be done, data is lost, a WCAG A or AA criterion fails, or a Dark Pattern is present;
- **fix**: an empty, error or loading state is missing, or a rule with evidence behind it is broken;
- **remark**: a single-source rule, a convention, or the part of a rule on which the sources disagree.

They apply to every project, brownfield included, on the screens a Change touches: a failure of use is not a
matter of taste (ADR-0009). They reach the Roles that can act on them before the review: `ux-research`, the
`ui-ux-designer` building the mock, the frontend Roles. The review also walks the main journeys in the running
app, because a dead end does not show in a screenshot.

A **Dark Pattern** (false urgency or scarcity, false social proof, a preselected paid extra, a cost hidden until
the last step, a cancellation harder than the sign-up) is not built, even when the requirements ask for it. The
`product-manager` names it when it appears, explains why, and proposes the honest form (a countdown to a real
deadline, real testimonials or none). The review blocks one that got through. Sample content marked as a sample
is allowed.

## Considered Options

- **Vendor the existing UX skills.** Rejected as the core: four good sources overlap and contradict each other,
  one has a known error that a vendored file cannot correct, and none covers whole flows. Three files are
  vendored as lookup material (Vercel's `command.md`, Impeccable's `clarify.md` and `harden.md`).
- **Let the reviewer decide the severity of each finding.** Rejected: Nielsen's own note is that one evaluator's
  severity ratings are too unreliable to trust, and two reviews of the same screen must agree.
- **Block only what a machine can check.** Rejected: most failures of use (a dead end, a missing state, a form
  that loses what was typed) are invisible to a static check.
- **Usability Rules only where aidw authors the design.** Rejected: unlike the Slop Check, these are not taste.
- **Warn about a Dark Pattern and build it when the user confirms.** Rejected: the people it harms are not in the
  conversation, and hidden costs and hard cancellation are unlawful in several places.

## Consequences

- Rules for flows that no source covers (sign-up, sign-in, reset, wizards, settings, a refused permission, undo
  or confirm, bulk actions, autosave) rest on aidw's reasoning. They are marked as aidw's own and do not block
  unless data is lost.
- Where sources disagree (when to validate, how to mark required fields, how long a toast stays, the size of a
  touch target) aidw follows the side with data, and the contested part never blocks.
- A brief for a UI task grows; the size is to be measured.
- A user may be refused something they asked for. The refusal comes at the requirements, with a reason and an
  alternative, not as a failed review at the end.
