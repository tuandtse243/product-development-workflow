# Stack knowledge lives in one stack pack per language

aidw supports only JS/TS today but should grow to other languages. Before this decision, JS knowledge was
spread across `quality-layers.md`, `code-style.md`, `stack-pool.md`, the implementer agent, `src/git.ts`
(junk paths) and `src/detect.ts`. We move it into one file per language, `profiles/stacks/<lang>.md`. Each
pack answers the same questions: package manager and install, formatter, linter, typecheck, test runner and
JUnit output, pre-commit hook, paths never committed, and a `.gitignore` template. Shared profiles and agents
say "per the project's stack pack", and the CLI reads junk paths for the stack `detect` finds. Adding a
language means adding one file and one test, not editing many.

## Considered Options

- Keep the knowledge where it is and add a column or section per language when a second one arrives.
  Rejected: every new language would touch about six files, and they would drift apart.

## Amendment (2026-11-14): framework packs

The factory design adds a second layer. A language pack still answers the tooling questions above. A
**framework pack** (first: Next.js, NestJS) answers how to build with that framework: structure, conventions
and common mistakes. Roles stay stack-neutral and load the language pack plus the framework pack the project
uses, so an Agent never reads the framework of the other side. Framework knowledge inside a Role folder was
rejected: one Role per stack would multiply the Roster. Packs move from `profiles/stacks/` to `stacks/` in
migration step 1 ([factory architecture](../factory-architecture.md)).
