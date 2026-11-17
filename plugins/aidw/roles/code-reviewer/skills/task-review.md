---
name: task-review
description: Review one task in two passes, the spec first and the code second, and hunt for failures that make no noise.
---

# Reviewing one task

Two passes, in this order. Do not start the second while the first has an open question: clean code that does the
wrong thing is still wrong.

## Pass 1: does it do what the spec says

1. List every scenario id the brief gives. For each, find its test and read the assertion, not the name.
   - The test drives the behavior the WHEN describes, through the real entry point (the route, the component, the
     command), not a helper two layers below it.
   - The assertion checks the THEN outcome. `toBeDefined`, `not.toThrow`, a snapshot of an empty render, or an
     assertion on a mock's own return value prove nothing.
   - The thing under test is not mocked away. A test that mocks the function it claims to test is a placeholder.
2. Read the requirement text once more and look for what the tests do not pin: the unhappy path the scenario names,
   limits ("at most", "within"), ordering, who is allowed.
3. Compare the diff with the task: anything built that no scenario asks for is scope creep. Anything a scenario asks
   for that is missing is a `fix`, even when every test passes.
4. Check each **Decision to honor**: name, key, format, library, exactly as written.

Stop here with `fix` if pass 1 found a blocking problem. List what you found; do not pile style remarks on top.

## Pass 2: is it built well

Read the diff as the person who will be paged for it.

- **Silent failures** (the ones a passing suite hides):
  - a `catch` that swallows, logs and continues, or returns a default that looks like success;
  - a promise that is not awaited, or an async callback inside `forEach`/`map` whose result is dropped;
  - a fallback value (`?? []`, `|| ""`, `.catch(() => null)`) on data that must exist;
  - an error turned into `200` with an empty body, or a UI that shows the empty state for a failed load;
  - a condition that can never be true or false, a loop that can run zero times where one pass is required;
  - a partial write: two changes that must both happen with no transaction and no cleanup.
- **Boundaries**: input from a user, a request or a file is validated where it enters; the empty list, the zero,
  the very long string and the duplicate request each have a defined result.
- **Data access**: a query inside a loop, a list with no limit, a missing index for a new filter or sort, a
  read-then-write with no guard against a concurrent writer.
- **Fit**: it follows the conventions of the files around it (naming, error shape, folder), reuses what exists
  instead of adding a second way, and leaves no dead code, commented-out code or debug output.
- **Tests as code**: no shared state between tests, no reliance on order, no sleep to wait for something, no
  real network or clock.

## Writing the verdict

- A blocking item names the file, what is wrong, and what the fix must achieve. One line each, most important first.
- Say what you verified by running it and what you only read. If you could not check something, say so.
- Do not ask for a rewrite when a small change fixes it, and do not block on taste.
- If pass 1 and pass 2 are both clean, the verdict is `pass`. Do not invent a finding to look thorough.

## Sources

Ideas, not wording: the two-stage review (spec compliance before code quality) of obra/superpowers
`subagent-driven-development`; the silent-failure hunt of Anthropic's `pr-review-toolkit`; the five-axis review of
Addy Osmani's `code-review-and-quality`, which stays the vendored checklist this skill is read with.
