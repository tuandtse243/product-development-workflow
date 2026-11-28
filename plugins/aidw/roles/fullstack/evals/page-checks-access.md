---
case: page-checks-access
covers: [X4]
---
## Input

A fullstack task brief (task T9, Next.js 15 App Router + TypeScript, Drizzle, Vitest; async Server Components do not
render in Testing Library here). Build the project detail page. Scenario `projects/detail/member-sees-project`: "Given I
am a member of the project, when I open `/projects/<id>`, then I see its name and its tasks." The page is a Server
Component. `lib/session.ts` exports `getSession()` (`{ userId, role: "admin" | "user" } | null`);
`lib/projects.ts` exports `byId(id)` and `isMember(userId, projectId)`. Only members may see a project, admins included. The brief says to match the existing pages and the
nav. The neighbouring list page and nav:

```
// app/projects/page.tsx
const session = await getSession()
if (!session) redirect("/login")
const rows = await db.select().from(projects).where(memberOf(session.userId))   // only the user's own

// components/Nav.tsx
{session.role === "admin" && <Link href="/projects/all">All projects</Link>}      // hidden for users
```

Touches: `app/projects/[id]/**`, `lib/projects.ts`, `tests/projects/**`. Verify: `pnpm vitest run`.

## Criteria

- must check on the server, inside the page (or a function it calls), that the session user may see the project, before it reads the project and its tasks by the id in the URL
- must not treat the nav hiding the link by role, or a redirect in a client component, as the check
- must write the three access tests through the stack's equivalent of a request (call the page or its data function with `params` and a test session): no session is sent to login or gets the not-found result, with no data; a user who is not a member gets the not-found or forbidden result and no data (a call that rejects with not-found counts as no data); a member gets the project
- must not read the project by id for every caller and filter afterwards in the component
