---
name: server-to-client-data
description: Treat data a server handed to client code without a route (props, a load return, a page payload) as a response - name its fields, check access in the page's server code, refresh after a write, and keep server-only imports out of shared modules.
---

# Data that crosses from server code to client code

Serves rules X3, X4 and X7. In Next.js, SvelteKit and Nuxt the server half often hands data to the client with no route
in between: a Server Component's props, a `load` return, a page payload. That data is serialized into the page, so it is
a response in every way that matters: whoever opens the page can read it, whether or not a component shows it. The same
goes for the page's own server code, which is an entry point, and for what the screen shows after a write.

## Steps

1. **Name the shape you hand across.** For each prop, `load` return or payload field that leaves server code, write a
   small view function that picks the fields the screen shows (`toProfileView(user)`), and hand its result over. A row,
   an entity, a whole `user` or a spread of one is never handed across (B5 for the seam). Put the view's type next to the
   component that takes it.
2. **Check access where the page reads.** A page, loader or Server Component that reads a record by an id in the URL
   checks, on the server and before the read, that this user may see it (B2, B3 for pages): the same three tests as a
   route (no session, wrong user, right user), through the stack's equivalent of a request. A redirect in client code or a
   link hidden by role is the convenience F11 allows, not the check.
3. **Show what the server stored after a write.** Whatever the write returns or the page re-reads is what the user sees:
   revalidate the path or tag (`revalidatePath`, `revalidateTag`), invalidate the cached read (`invalidateQueries`,
   `invalidate`, `refresh`), or render the response body. Do not set the typed value into state. Test it with a value the
   server changes (a trimmed name, a generated id, a new total).
4. **Keep shared modules free of server-only imports.** A schema or type both halves import (X2) imports no database
   client, no secret and no `server-only` module; the server-only code imports the shared one, never the other way. A
   client file that reaches a server-only module by any path breaks F10; `public-env-scan` lists such imports.
5. **Check before you reply**: no handed-across value is a row; each restricted page has its three access tests; each
   write that a screen shows has a test on a value the server changed.

## Right and wrong

A profile page in Next.js reads the signed-in user's record and renders a client card.

Right: the card receives a view with only what it shows, and the page checks the session first.

```
// app/profile/[id]/page.tsx (Server Component)
const session = await getSession()
const { id } = await params                                        // Next 15: params is a Promise
if (!session || session.userId !== id) notFound()                  // X4: checked before the read
const user = await users.byId(id)
return <ProfileCard user={toProfileView(user)} />                  // X3: { id, name, avatarUrl }
```

Wrong: the whole row crosses, and the only check is a hidden link.

```
const { id } = await params
const user = await users.byId(id)                                  // any id in the URL is read
return <ProfileCard user={user} />                                 // passwordHash and stripeCustomerId ship in the page payload
```

## Sources

Ideas, not wording: aidw's backend rule B5 (a response is built from an explicit shape) and B2/B3 (access on every entry
point); frontend rules F10 and F11; `library/skills/react-rules` (what a Server Component passes to a client component is
serialized, a Server Action checks its caller, revalidate after a mutation); `stacks/nextjs.md`, `stacks/sveltekit.md`
and `stacks/nuxt.md`; the Next.js documentation on data security and `revalidatePath` (MIT); the SvelteKit documentation on
`load` and `invalidate` (MIT); `library/skills/react-rules` and the stack packs are aidw's own.
