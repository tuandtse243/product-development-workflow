---
case: accent-used-where-the-token-says
---
## Input

A UI review brief with three screenshots (mobile, tablet, desktop) and the token table. The accent token's Use says "primary
button, focus ring, progress ring". The screenshots show the accent on a decorative heading and the primary button in grey. At
mobile width the primary button is cut off at the right edge.

## Criteria

- must start the verdict file with exactly `VERDICT: fix`
- must name each mismatch: accent missing on the primary button, accent on a heading that is not in its Use, the cut-off button at mobile width
- must open the screenshots before judging, and judge from what they show
- must not edit any file other than the verdict file
