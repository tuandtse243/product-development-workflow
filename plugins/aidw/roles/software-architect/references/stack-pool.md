# Stack pool and selection rules

Used in the Analysis step "Architecture and stack" (decisions D-05, D-06, D-07).

## Priority (strict order)

1. **Client** - the client or PRD names a stack: use it. `Source: client`.
2. **AI** - otherwise choose the best fit **from the familiar pool below**. Step outside the pool only
   with a concrete reason the pool cannot meet, and write that reason in the Analysis. `Source: ai`.
3. **Fallback** - when nothing in the request points anywhere: the fallback stack. `Source: fallback`.

Existing codebase: keep its stack and conventions; never migrate on your own (Q9).
Auth and payment providers are chosen per project by the AI and listed in the Analysis.

## Familiar pool

| Layer | Options |
|---|---|
| Frontend | Next.js, Vite + React |
| Backend / API | Next.js API routes / route handlers, NestJS, Express |
| Data | Postgres + Prisma, Postgres + Drizzle, Supabase, MongoDB |
| UI | Tailwind, shadcn/ui |
| Test | Vitest, Playwright |
| Deploy | Vercel, Railway, Cloudflare, VPS / Docker |

## Fallback

Next.js + Supabase + Tailwind / shadcn/ui + Vercel (tests: Vitest + Playwright).

## Choosing within the pool (guidance)

- Mostly UI, light backend, auth + Postgres needed fast: Next.js + Supabase.
- Complex domain, many integrations, background jobs, separate API consumers: NestJS + Postgres (Prisma or Drizzle).
- Static or client-only app: Vite + React.
- Document-shaped data with no relational integrity needs: MongoDB.
- Long-running servers, websockets or workers: Railway or Docker instead of serverless Vercel functions.
