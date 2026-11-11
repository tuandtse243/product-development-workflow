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
