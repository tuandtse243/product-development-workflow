---
name: reading-budget-reports
description: Read the performance layer's measurements - Lighthouse, bundle sizes - and rank what costs the user most, without inventing a number.
---

# Reading the measurements

You judge what was measured. A number you did not read in the layer's output or a report file does not exist:
never estimate a metric, and never write one from memory of what such an app "usually" scores.

## Know what kind of number it is

- **Lab** data (Lighthouse in the layer): one run, one device profile, a cold cache. Good for comparing before and
  after and for finding causes. Say "lab" every time you quote it.
- **Field** data (real users, e.g. the Chrome UX Report): what users had. A new project has none. Never present a
  lab number as what users experience.
- Lighthouse cannot measure Interaction to Next Paint without interaction; Total Blocking Time is its lab stand-in.
- One run is noisy. A difference of a few percent between two runs is not a finding.

## What to read, in this order

1. **The budgets in the brief** and which ones failed or passed narrowly (within a tenth of the limit: say so,
   it will fail next month).
2. **The three Core Web Vitals** and what each points to: Largest Contentful Paint (good at 2.5 s or less: the
   server response, render-blocking resources, the LCP image or font), Interaction to Next Paint (good at 200 ms
   or less; in the lab, long tasks and Total Blocking Time), Cumulative Layout Shift (good at 0.1 or less:
   images without dimensions, late-loading content, fonts).
3. **The opportunities and diagnostics** of the report, by estimated saving, not by how many there are.
4. **The bundle**: the size of what the first screen loads, the largest modules, anything shipped to every page
   that one page uses, a dependency that appears twice.

## Rank by impact

For each candidate: which metric it moves, by roughly how much according to the report, on which pages, and how
big the fix is. Report at most five, biggest first. A finding is "the hero image is 1.8 MB and is the LCP element
(lab LCP 4.1 s, budget 2.5 s): serve it at display size in a modern format", not "optimize images".

## Verdict

`fix` when a budget the Analysis set is exceeded, or when the diff adds a cost that will exceed it under the
scale the spec states (the `query-cost-in-a-diff` skill). Otherwise `pass`, with what is close to the limit under
Non-blocking. Say what was not measured (pages without a run, no field data, mobile only).

## Sources

Ideas, not wording: web.dev's Core Web Vitals guidance and thresholds, the Lighthouse documentation (lab versus
field, scoring, variability), Addy Osmani's `performance-optimization` (the vendored checklist) and
`web-quality-skills`.
