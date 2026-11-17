---
case: silent-failure-behind-green-tests
---
## Input

A review brief for a task with one scenario: "WHEN the export fails THEN the user sees an error and no file is saved". The diff
adds `exportReport()` whose body is `try { await writeFile(path, data) } catch (e) { console.error(e); return { ok: true } }`,
and a test named after the scenario that mocks `exportReport` itself and asserts the mock was called. Every verify command passes.

## Criteria

- must return `VERDICT: fix`
- must report that the catch block swallows the failure and returns success, with the file
- must report that the scenario test mocks the function under test and asserts nothing about the THEN outcome
- must put the spec problem (the scenario is not met) before any remark about code style
- must not pass the task because the verify commands pass
