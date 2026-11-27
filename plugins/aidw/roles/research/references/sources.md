# Sources: which to trust, how to cite them, how long to look

Every Research Skill that uses the web follows this page. The Skill says what to look for; this page says how much a
source counts, how a claim is recorded, and when to stop searching.

## A source counts by its rung on the ladder

1. **Official documentation of the version in question**: the vendor's docs, reference, limits and pricing pages for
   the version or plan the question is about. For a product, its own pages. For a world in a world scan, the record
   of the museum, archive or collection that holds the object, or the trade's own documents.
2. **Changelogs, release notes, migration guides, maintainers' issues and discussions, official examples**: what the
   people who ship the thing wrote about it. They settle what changed between versions.
3. **Named experts and organisations**: an author or body you can name and check (a known maintainer's blog, a
   standards body, an analyst firm, a regulator, reputable press). At most `medium` confidence on their own.
4. **Forums, Q&A sites and blogs**: leads only. They tell you where to look and which words to search; the claim is
   cited from the rung 1 to 3 page the lead took you to, or it goes under `Not found`.

Pages that are AI-written or copied from another page (content farms, scraped mirrors, summaries with no author) are
not sources at any rung. Cite the original they came from, if you can open it.

What users say is the one place a rung 4 page is the record: a review, a forum thread or an app-store rating is cited
as "users report", with how many and when, and never as proof of how the product works.

"Best practice" is written only when the official documentation recommends it, or when two independent sources of
tiers 1 to 3 agree; otherwise it is one source's opinion and the note says whose. For every recommendation, also
search its pitfalls, anti-patterns and known issues, and record what you found or that you found none.

## Official docs are read from the cleanest copy first

For a library or service, fetch its official documentation in this order and stop at the first that answers:

1. **A docs MCP server configured in the session** for that library or service (its tools are listed to you; never
   install or configure one).
2. **`/llms.txt`** at the docs site's root (`https://<docs site>/llms.txt`), then the Markdown pages it lists that
   bear on the question. Try it even when no search result shows it: many docs sites have one.
3. **The HTML pages** of the documentation.

Fetch every page with WebFetch, never with `curl` or any other shell command: the network stays closed to the
shell (ADR-0016). Every rung is still tier 1 when it is the vendor's own documentation of the version in question.

## Every claim carries a quote and a link to its section

| # | Claim | Quote | Source (title, URL#anchor, date read) | Tier | Kind | Confidence |
|---|---|---|---|---|---|---|

- **Quote**: the source's own words that carry the claim, at most two sentences, in the source's language. An
  `inference` row quotes nothing and names the rows it rests on.
- **Source**: the link goes to the section anchor (`.../limits#sending-quota`), not the top of the page; when the page
  has no anchors, name the heading. Only pages you opened: never a search snippet. A result from a docs MCP server
  is cited by the page URL and anchor it returns; when it returns none, by the server's name, the tool and the
  query (`context7 get-library-docs "next 15.1 caching"`), and the row's confidence follows the page you can link.
- **Tier**: 1 to 3 from the ladder; `4` only on a "users report" row; none on an `inference` row.
- **Kind**: `fact` (the source states it) or `inference` (you conclude it). An `inference` row's confidence is
  never higher than the lowest of the rows it rests on.
- **Confidence**: `high` (tier 1, or two independent tier 2 sources), `medium` (one tier 2 or tier 3 source), `low`
  (old, undated, self-interested about quality, or a "users report" row). A version or a number carries its date and
  what it measures.

A Docs Brief (`docs-research`) adds a `Version` column after Source: the version of the library the claim holds for.

## The first pass is 2 to 3 searches and 3 to 5 pages

Start with 2 to 3 searches, open the 3 to 5 most promising pages, then refine the query from what they taught you
(the right term, the right domain, the version). Going past that is allowed when the question needs it; explain it
in the note: how many searches and pages it took, and why.

Write the query for the kind of question:

- **API or library**: after the fetch order above (a docs MCP server, then `llms.txt`) has not answered:
  `site:<official docs domain> <feature> <version>`; then the changelog or release notes for that version
  (`site:github.com/<org>/<repo> releases <feature>`).
- **Best practice**: `<topic> best practices <year>` and, always, `<topic> pitfalls` or `<topic> anti-patterns`;
  prefer named authors and organisations.
- **Error**: the exact message in quotes, plus the library and version; then the maintainers' issue tracker
  (`site:github.com/<org>/<repo>/issues "<message>"`).
- **Comparison**: `<X> vs <Y>`, the migration guide between them, and each one's limits page with `site:`.

Use `site:` for every official domain you know, quotes for exact phrases, and `-term` to drop noise.

## Sources

Ideas, not wording: the `web-search-researcher` agent and subagent reference of HumanLayer's `rpi` plugin (MIT:
search strategies per kind of question, the search-efficiency budget, quotes with links to sections, `site:` for
authoritative domains, `llms.txt` and its Markdown pages before HTML; aidw fetches them with WebFetch where rpi used
`curl`), and this Role's own `evidence-scan` for confidence stated apart from the claim.
