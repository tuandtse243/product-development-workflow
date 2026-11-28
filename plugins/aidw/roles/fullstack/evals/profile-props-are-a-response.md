---
case: profile-props-are-a-response
covers: [X3, server-to-client-data, library/react-rules]
---
## Input

A fullstack task brief (task T8, Next.js 15 App Router + TypeScript, Drizzle, Vitest; async Server Components do not
render in Testing Library here). Build the profile card of the signed-in user: scenario
`account/profile/card-shows-profile`: "Given I am signed in, when I open `/profile`, then I see my name, my avatar and the
plan name, and an Edit link." The card needs hover and a menu, so it is a client component. The `users` table has
`id, name, email, avatarUrl, planId, passwordHash, stripeCustomerId, createdAt`, and `planId` points at the `plans(id, name)` table. `lib/session.ts` exports `getSession()`
(`{ userId } | null`). The neighbouring page the brief says to match:

```
// app/settings/page.tsx
const session = await getSession()
if (!session) redirect("/login")
const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) })
return <SettingsPanel user={user} />        // "use client" component, reads user.name and user.email
```

Touches: `app/profile/**`, `components/ProfileCard.tsx`, `lib/profile.ts`, `tests/profile/**`. Verify: `pnpm vitest run`.

## Criteria

- must not pass the `user` row, an entity or a spread of it to the client component: the props are built by a view function that names the fields (for example `{ name, avatarUrl, planName }`)
- must keep `passwordHash`, `stripeCustomerId` and `email` out of what the page hands to the client card, since the screen shows none of them
- must have a test that calls the view builder or the page's data function with a row that has `passwordHash` and `stripeCustomerId`, and asserts neither appears in the result (a contract test, since the async Server Component does not render in the test)
- must name the view's type once (the card takes it as its prop type) and type the builder's return with it
- must keep `'use client'` on the card only and not on the page, and must not copy the neighbour's `user={user}` pattern into the new page
- must not rely on the card not displaying the field as the reason it is safe to pass it
