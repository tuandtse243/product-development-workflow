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

First run `aidw plugin-path roles/research/references/sources.md` and read the file it prints: it ranks sources,
sets the first search budget and gives the query for each kind of question.

- the products themselves: their sites, pricing pages, documentation, changelogs (tier 1 and 2);
- what their users say: reviews, forums, issue trackers, app-store ratings (complaints tell you more than praise),
  cited as "users report";
- independent accounts: reports, benchmarks, regulators, reputable press (tier 3);
- the absence of something is a finding only if you say where you looked.

Prefer a primary source to a summary of it, and a dated source to an undated one. Open the page: never cite a
search result's snippet, and never cite a page you did not read.

## 3. Record each claim

| # | Claim | Quote | Source (title, URL#anchor, date read) | Tier | Kind | Confidence |
|---|---|---|---|---|---|---|

The columns are the ones `sources.md` defines. Two rules matter most for a market question: a vendor's claim about
itself is `low` for quality and fine for price and features; and a number keeps its date and what it measures, so
"about 30%" never becomes "30%".

## 4. Try to be wrong

Before concluding, search for the opposite: the competitor you did not know, the reason the obvious answer fails,
the case where the popular choice is a bad fit, its known pitfalls. Put what you found under "Against".

## 5. The note: `.aidw/research/<id>.md`, at most two pages

`## Question` (and the decision it serves), `## Answer` (three to five lines; each sentence ends with its claim
numbers), `## Evidence` (the table), `## Against` (what points the other way), `## Not found` (what you looked for
and where), `## What I would check next`.

You inform the decision. You do not recommend scope or stack: the Product Manager and the Software Architect do.

## Sources

Ideas, not wording: the investigation skills of deanpeters/Product-Manager-Skills, the citation discipline of
the cited-research and deep-research skill families, the intelligence practice of stating confidence separately
from the claim (ICD 203), the CRAAP test for judging a source, and the
`web-search-researcher` of HumanLayer's `rpi` plugin (MIT) for the quote with its link, through `sources.md`.
