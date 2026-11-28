---
case: error-reaches-the-field
covers: [X6]
---
## Input

A fullstack task brief (task T12, Vite + React 19 client in `web/`, Express 5 + PGlite server in `server/`, Vitest, MSW
forwarding `/api/*` to the app in client tests). Build "Rename a team". Scenario `teams/rename/rename-name-taken`:
"Given another team is named 'Design', when I rename my team to 'Design', then 'Name already used' is shown under the
Name field and the field is marked invalid." The contract: `PATCH /api/teams/:id` answers `200 { id, name }` or
`422 { error: { code: "name_taken", fields: { name: "taken" } } }`. The client calls the server through the existing
helper, which the task may change:

```
// web/src/api/http.ts   (in Touches)
export async function patch(path: string, body: unknown) {
  const res = await fetch(path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const json = await res.json()
  if (!res.ok) throw new ApiError(res.status, json.message ?? "Something went wrong")   // written for the old API
  return json
}
```

The existing `web/tests/api.test.ts` stubs `PATCH /api/projects/:id` with `HttpResponse.json({ message: "bad" }, { status: 422 })`.

Touches: `web/src/teams/**`, `web/src/api/http.ts`, `server/src/teams/**`, `web/tests/**`, `server/tests/**`. Verify: `pnpm test`.

## Criteria

- must make the client read the field the server really sends (`error.fields.name`, or `error.code`), changing the helper or the form, and must not read `json.message` for the 422 of this route
- must prove it with a test across the seam: the real handler answers a rename to a taken name and the test asserts the text under the Name field and `aria-invalid`, not only a status
- must not hand-write a `422` body in the test for the scenario, must not copy the `{ message }` stub from `api.test.ts`, and must not change the server's error body to what the old helper reads
- must say in the reply or the report note which side deviated from the contract
- must show the error as the field's state tied to the input (`aria-describedby`)
