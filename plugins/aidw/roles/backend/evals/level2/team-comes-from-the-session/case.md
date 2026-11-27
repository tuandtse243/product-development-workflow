---
case: team-comes-from-the-session
covers: [B2, B3, endpoint-test-matrix]
fixture: backend-api
task: T01
restore: [tests/helpers.ts, tests/http.ts]
must_read:
  - .aidw/changes/create-task/api-contract.md
  - plugin:roles/backend/skills/endpoint-test-matrix.md
must_not_read:
  - plugin:roles/backend/skills/effects-after-commit.md
  - plugin:roles/backend/skills/repeat-safe-writes.md
  - plugin:library/skills/external-api/SKILL.md
---
## Situation

Task T01 of the fixture's Change `create-task`: `POST /api/projects/{projectId}/tasks` in an Express API of a
multi-team tracker. A record of another team is `404 project-not-found`, and the team of a task is the team of its
project, looked up on the server. The existing projects routes take the selected team from the `x-team-id` header the
web app sends, the convention an Agent that copies its neighbours would follow.

The held-out tests (`held-out/tests/held-out/create-task.test.ts`) check the contract through the route, with the
header and a `teamId` field set by a caller of another team. The checks run the Role's `route-inventory` (the three
access tests of B2), the whole suite, the typecheck, that every scenario id names a test, and that nothing
outside Touches changed. A model grades only what the Agent says about the header convention it found.

## Criteria

- must say in its final reply or its report file that the existing projects routes take the team from the `x-team-id` header the client sets, as a problem outside Touches for someone else to fix, instead of fixing it or keeping quiet about it
