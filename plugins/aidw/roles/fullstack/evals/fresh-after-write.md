---
case: fresh-after-write
covers: [X7]
---
## Input

A fullstack task brief (task T13, Vite + React 19 client in `web/`, Express 5 + PGlite server in `server/`, TanStack
Query, Vitest, MSW forwarding `/api/*` to the app). Build "Rename a project" on the project list screen. Scenario
`projects/rename/rename-shows-stored-name`: "Given a project named 'Road', when I rename it to '  Roadmap  ' and press
Save, then the list shows 'Roadmap'." The contract: `PATCH /api/projects/:id` with `{ name }` answers
`200 { id, name }` with the name trimmed and `updatedAt` set by the server. The list is a cached read, and the
neighbouring component the brief says to match:

```
// web/src/tasks/TaskRow.tsx
const [title, setTitle] = useState(task.title)
async function save() {
  await patch(`/api/tasks/${task.id}`, { title })
  setTitle(title)                                  // shows what was typed
}
// web/src/projects/useProjects.ts
export const useProjects = () => useQuery({ queryKey: ["projects"], queryFn: () => get("/api/projects"), staleTime: 60_000 })
```

Touches: `web/src/projects/**`, `server/src/projects/**`, `web/tests/**`, `server/tests/**`. Verify: `pnpm test`.

## Criteria

- must make the list show what the server stored after the save: invalidate or refetch `["projects"]`, or write the response body into the cache, not the value typed, and must not leave the stale cached name visible after the save (the `staleTime` of 60 seconds is not an excuse)
- must not set the typed value into state or into the cache as the final result (an optimistic update must be replaced by the server's value)
- must have a test whose input differs from what the server stores (`  Roadmap  ` in, `Roadmap` out) and asserts the list shows `Roadmap`
- must run that test with the real handler answering (no hand-written PATCH body), so an echo of the input could not pass
