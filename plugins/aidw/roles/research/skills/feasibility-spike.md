---
name: feasibility-spike
description: Answer "can this stack or service do it at all" with the smallest experiment that would prove it, a fixed time box, and proof someone else can check.
---

# Feasibility spike

A spike answers one yes-or-no question that reading cannot settle. It produces knowledge and a note, never code
that the product keeps.

## 1. One question, and what counts as proof

Write, before trying anything:

- the question: "Can the provider's API create a recurring payment with a trial period in one call?"
- what **yes** looks like: an observable result (a response, a measurement, a file) that someone else can check;
- what **no** looks like, and what would be inconclusive;
- the limit: the fewest steps that could answer it, and where you stop.

If you cannot say what proof looks like, the question is not ready: return it.

## 2. Read first

The answer is often in the official documentation, the changelog, the issue tracker or the limits page. Cite the
exact page and its date. A spike that documentation already answers is not run. A claim from memory about what a
library or service does is not evidence: versions change.

## 3. If an experiment is needed

- Before the Approval Gate you write only under `.aidw/`: put the experiment in `.aidw/research/spikes/<id>/`.
  Nothing is added to the project, and nothing is installed into it.
- No real credentials, no paid calls, no production data. If the question cannot be answered without one, that
  is the finding: say exactly what the user would have to provide or run.
- Keep it to one file where you can. Measure what you claim; do not estimate.
- Record what you ran, the versions, and the output that is the proof, cut to the lines that matter.

## 4. Report: a section `## Feasibility` in `.aidw/research/<id>.md`

- **Question** and why it matters to the decision.
- **Answer**: yes, no, or not determined; in one sentence.
- **Proof**: the citation, or the command and its output, and the versions.
- **Limits found on the way**: quotas, missing features, costs, licence terms, anything a plan must respect.
- **What was not tested** and would still need to be.

Then delete nothing and build nothing further: the spike is thrown away when the Change is archived. If the
answer is "no", say what the nearest thing that does work is, as a fact, and leave the choice to the architect.

## Sources

Ideas, not wording: the spike of Extreme Programming (Kent Beck, Ward Cunningham), the spike skill of the hermes
agent project, and the "make the test first" habit of scientific method: decide what would falsify the claim
before you look.
