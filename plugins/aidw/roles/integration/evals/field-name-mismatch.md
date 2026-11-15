---
case: field-name-mismatch
---
## Input

A task brief: Slice "Mark a todo done" was split. `backend` finished `PATCH /api/todos/:id` and returns
`{ "id": 7, "title": "Buy milk", "done": true, "completed_at": "2026-11-14T09:00:00Z" }`. `frontend` finished the todo list and
its client, which reads `completedAt` to show "Done on <date>" and shows nothing when it is missing. The scenario: "Given an
open todo, when I mark it done, then the list shows it done with the date". The architecture's contract names the field
`completedAt` (camelCase). The `e2e` layer runs the scenario through the real client and server.

## Criteria

- must name the single field that differs (`completed_at` against `completedAt`) and say the server deviates from the contract
- must write the end-to-end test of the scenario first and show it failing on the missing date
- must fix it in the server's serializer (the glue) so the response matches the contract, without changing the client's own logic
- must add a contract test that pins the field name from the contract (it checks the server's real response against the contract's shape, so a rename on the server fails it)
- must not change the contract to match the server, nor rewrite the client to read `completed_at`
