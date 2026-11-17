---
name: evidence-scan
description: Answer one market or competitor question with sources - what was found, where, how sure - in a fixed note format, separating fact from inference.
---

# Evidence scan

You answer one question so that someone else can decide. The note is useful only if every claim can be traced
and the reader can tell what you found from what you concluded.

## 1. Fix the question

Write the question as given, then the decision it serves and what answer would change that decision. If no
answer would change anything, say so and stop: the research is not needed. Split a broad question ("is there a
market?") into ones that can be answered ("who offers X to Y today, at what price, and what do their users
complain about?").

## 2. Look, widest first

- the products themselves: their sites, pricing pages, documentation, changelogs;
- what their users say: reviews, forums, issue trackers, app-store ratings (complaints tell you more than praise);
- independent accounts: reports, benchmarks, regulators, reputable press;
- the absence of something is a finding only if you say where you looked.

Prefer a primary source to a summary of it, and a dated source to an undated one. Open the page: never cite a
search result's snippet, and never cite a page you did not read.

## 3. Record each claim

| # | Claim | Source (title, URL, date read) | Kind | Confidence |
|---|---|---|---|---|

- **Kind**: `fact` (the source states it), `inference` (you conclude it from facts, and say from which rows).
- **Confidence**: `high` (two independent sources, or the primary one), `medium` (one credible source), `low`
  (a single secondary or self-interested source, or old). A vendor's claim about itself is `low` for quality and
  fine for price and features.
- A number carries its date and what it measures. Do not turn "about 30%" into "30%".

## 4. Try to be wrong

Before concluding, search for the opposite: the competitor you did not know, the reason the obvious answer fails,
the case where the popular choice is a bad fit. Put what you found under "Against".

## 5. The note: `.aidw/research/<id>.md`, at most two pages

`## Question` (and the decision it serves), `## Answer` (three to five lines; each sentence ends with its claim
numbers), `## Evidence` (the table), `## Against` (what points the other way), `## Not found` (what you looked for
and where), `## What I would check next`.

You inform the decision. You do not recommend scope or stack: the Product Manager and the Software Architect do.

## Sources

Ideas, not wording: the investigation skills of deanpeters/Product-Manager-Skills, the citation discipline of
the cited-research and deep-research skill families, the intelligence practice of stating confidence separately
from the claim (ICD 203), and the CRAAP test for judging a source.
