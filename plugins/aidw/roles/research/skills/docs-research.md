---
name: docs-research
description: Write a Docs Brief - what the official documentation says about one library or service at the installed version on one topic - with the version of every claim, the pitfalls, and what could not be found.
---

# Docs research

An implementer has no web and remembers libraries as they were in some other version. You give it what the official
documentation says for the version the project has installed, on one topic, in a brief it can trust without
re-reading the sources. The brief belongs to the project, not to one Change: later Changes reuse it.

## A fresh brief is reused, not rewritten

Run `aidw docs-brief <lib>@<installed version> <topic>` first. `FRESH` means a brief of the same major.minor, at most
90 days old, already answers: reply with its path and stop. `MISSING`, `STALE` or `INVALID` prints the path to write
(`.aidw/research/docs/<lib>@<major.minor>-<topic>.md`) and why. A stale brief is rewritten whole from the sources,
not patched.

## The installed version comes before any page

Find the version before you search, in this order:

1. the lockfile (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `poetry.lock`, `uv.lock`,
   `Cargo.lock`, `go.sum`, `Gemfile.lock`): the exact version installed;
2. the manifest (`package.json`, `pyproject.toml`, `go.mod`, ...) when there is no lockfile: the range, and say the
   brief holds for its lower bound;
3. the stack in the architecture (`.aidw/architecture/overview.md`, `## Stack` in the Change's `analysis.md`) when
   nothing is installed yet;
4. for a hosted service, the API version or the SDK version the project calls.

Write where you read it. When none of these names a version, the brief is for the latest stable release, and the
Answer says so in its first line.

## Read the documentation of that version

Run `aidw plugin-path roles/research/references/sources.md` and read the file it prints: it ranks the sources, sets
the order you fetch the official docs in (a docs MCP server, then `llms.txt`, then HTML, with WebFetch only), shapes
the claim table and sets the search budget.

Prefer the docs of the installed version: a versioned URL, a version selector, the docs tagged in the repository.
When the site shows only a newer version, read the changelog and the migration guides between the two versions and
say which claims you carried back and why they still hold.

Every claim names the version it holds for, in the `Version` column. A claim you could only find for another
version says so; it is never silently moved to the installed one.

## Newer documentation that differs is a pitfall, not the answer

When the docs of a newer version say something different (a renamed option, a changed default, a removed API), the
Answer keeps what holds for the installed version and Pitfalls records the difference with both versions: "In 15.2
`fetch` in route handlers is cached again by default; this project has 15.1". An implementer then knows which advice
to ignore and what breaks on upgrade.

## Best practice needs the docs or two sources, and pitfalls are always searched

Write "recommended" only when the official documentation recommends it, or two independent sources of tiers 1 to 3
agree (sources.md). For the topic, search its pitfalls, anti-patterns and known issues for the installed version
(the maintainers' issues, the changelog's breaking changes, the docs' own warnings), and record what you found or
that you found none, with where you looked.

## The brief has five sections and front matter for its reuse

```markdown
---
lib: next
version: 15.1.3
topic: caching
date: 2026-11-26
---

# next@15.1 caching

## Question
<the question as asked, and the task or decision it serves>

## Answer
<a few lines that stand alone: the brief of a task carries them word for word>

## Evidence
| # | Claim | Quote | Source (title, URL#anchor, date read) | Version | Tier | Kind | Confidence |
|---|---|---|---|---|---|---|---|

## Pitfalls
<each with the version it concerns, its source row, and what to do instead; or "None found" and where you looked>

## Not found
<what you looked for and could not find, and where you looked; or "None.">
```

- `version` is the installed version, exactly (quote it when YAML would read it as a number: `"15.10"`); `date` is
  the day you wrote the brief. Without them `aidw docs-brief` reports the brief as invalid and it is never reused.
- `lib` is the package or service name as the project names it (`@tanstack/react-query`); `topic` the words of the
  question's subject, with at least one ASCII letter or digit (the file name keeps only those).
- A prerelease and a 0.0.x patch share the `<lib>@<major.minor>` file with the rest of their line: writing a brief for
  one overwrites the brief that was there.
- Answer and Pitfalls stand alone: the brief of a task inlines them, without the Evidence.
- A blog or forum post is a lead, never Evidence: it gets no row in the table, and its claim is not repeated
  anywhere in the brief unless an official source states it (then cite that source).
- Then run `aidw docs-brief` again: it must print `FRESH`.

## A question from the build gets the same discipline in the answer file

After the gate an implementer may consult you once per task about what its Docs Brief did not foresee. The
Consultation brief names the one file you write; answer there with the same rules: installed version first, the
official docs of that version, a quote and a link per claim, newer docs as pitfalls, what you could not find. You
ask no person, and you do not write a Docs Brief from the build.

## Right and wrong

Right

> ## Answer
> In Next.js 15.1 (installed, `package-lock.json`), a `GET` route handler is not cached by default; opt in with
> `export const dynamic = "force-static"` (rows 1-2).
>
> ## Pitfalls
> - Tutorials written for 14.x say `GET` handlers are cached by default; that changed in 15.0 (row 3). Code copied
>   from them serves fresh data in 15.1, not the cached data they promise.

Wrong

> ## Answer
> Route handlers are cached by default, so wrap them in `noStore()`. This is best practice.

It answers from memory of another version, names no version, cites nothing, and calls one habit best practice.

## Done when

The installed version and where it was read are stated; `aidw docs-brief` prints `FRESH` for the file you wrote;
every claim has a quote, a link to its section and its version; newer docs that differ and the pitfalls you found
are listed; what you could not find says where you looked. Reply with the path and the Answer in three lines.

## Sources

Ideas, not wording: HumanLayer `rpi` (MIT, github.com/humanlayer/skills, `plugins/rpi`): the `web-search-researcher`
agent and its subagent reference (official docs first, the changelog for version-specific details, `llms.txt` and
the Markdown pages it lists before HTML, best practices searched with their anti-patterns, gaps reported). aidw
fetches with WebFetch instead of `curl` (ADR-0016) and adds the installed version, the reuse rule and the Version
column. The source ladder and the claim table come from this Role's `sources.md`.
