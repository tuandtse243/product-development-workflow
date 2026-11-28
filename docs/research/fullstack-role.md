# Fullstack Role upgrade: research report

Date: 2026-11-28. Scope: `plugins/aidw/roles/fullstack/` (plan task T20 onward, after frontend). Nothing in the repo was
changed except this file. The pattern is the finished backend and frontend Roles and `docs/research/frontend-role.md`.

Marking: **[V]** verified by opening the file in this session; **[M]** from memory, check before relying on it.

The question this report answers: fullstack already follows both rule tables (`follows_rules: [backend, frontend]`)
and points at both Roles' skills. What does a Role that builds **both halves of one Slice** need that neither half
covers? Call it the seam.

---

## 1. What fullstack has today [V]

| Item | Today |
|---|---|
| `role.md` front matter | worker, deep, write, 6 tools; `consults: [api-designer, database-architect, software-architect, research]`; `reads: [tasks, delta-specs, constitution, design-tokens]`; `follows_rules: [backend, frontend]`; skills `library/external-api`, `library/resilient-integration` |
| `role.md` body | Responsibility (both rule tables bind their half); "Slice that has a server side" (test through the public interface, the six backend skills by path); "Slice that has a screen" (tokens per frontend's step 4, the five frontend skills by path) |
| `rules.md`, `skills/`, `scripts/`, `references/`, `lessons.md` | none |
| `evals/` | one level 1 case `test-first-within-touches.md`, no `covers:`, no `results.json`; no `level2/` |
| Boundaries table, Procedure, Done when, Report template | none of its own (only `library/implement-a-task.md`'s shared ones) |

### 1.1 How often fullstack runs [V]

Fullstack is not a niche Role. It is the **default implementer**:

- `roles/technical-planner/role.md` line 107: "Default: one `fullstack` task delivers the whole Slice." A Slice is split
  (backend + frontend + `integration`) only when its contract is shared with another Slice, it has a migration (always a
  `database` task), or both halves are big enough to pay for parallel agents.
- The **scaffold** task (`package.json`, tool config, test harness, database client and config) is `fullstack`
  (technical-planner line 119).
- `src/analyze.ts:323`: a task with an unknown Role or a Role that cannot write code runs as fullstack;
  `agentForTask` (`src/roles.ts`) falls back to the default task Role; `workflows/feature.yaml:186` `implement: fullstack`.

So the seam rules below would bind most tasks of most Changes, and in a non-split Slice **no `integration` task runs**:
nobody else proves the two halves meet.

---

## 2. Findings: the seam

**S-1. No one proves the halves meet in a non-split Slice.** In a split Slice the `integration` Role writes the
end-to-end test and a contract test (`roles/integration/role.md`, skill `contract-tests`). In a fullstack Slice the
backend rules ask for tests through the route (B2, B6) and the frontend rules ask for tests through the rendered screen
with the network faked (F6, frontend Procedure step 5). Both can pass while the client sends `dueDate` and the server
reads `due_date`: each half is tested against its own idea of the shape. Neither table has a rule that one test crosses
the seam.

**S-2. Two copies of one shape.** The frontend rule F9 says client checks mirror the contract; B4 says the server
validates. When one agent writes both, the cheapest correct form is one schema both halves import. Nothing says so, and
the obvious way to do it can break F10 (a `lib/schemas/project.ts` that also imports the database client, pulled into a
client file). `contract-tests` says "prefer a single schema both sides import" but it is integration's skill and
fullstack does not list it.

**S-3. Data handed from server code to client code is a response, but no rule calls it one.** B5 ("a response is
built from an explicit shape, never the row") is worded for "a route returns". In Next.js, SvelteKit and Nuxt the
server half often hands data to the client without a route: a Server Component's props to a `'use client'` component, a
`load` return, a Nuxt payload. That data is serialized into the page (`library/skills/react-rules/SKILL.md:25` [V]),
so a `user` row passed as props ships its `passwordHash`. The stack packs say the payload must be serializable
(`stacks/sveltekit.md:24` [V]), not that it must be shaped.

**S-4. A loader or page is an entry point.** B2/B3 cover "a route, server action or RPC method". A Server Component
or `load` function that reads a record by an id in the URL is the same thing without the name. F11 says the client
guard is only a convenience and the API must check; with no API in between, the page's server code is where the check
lives. Neither table says so for loaders. (`react-rules` says a Server Action checks its caller [V]; nothing for a page.)

**S-5. Inherited "ask" rules point at the wrong person when you own both halves.** Frontend rules were written for an
agent that does not own the server:

| Inherited rule | As written | When the server half is in your Touches |
|---|---|---|
| F11 | API does not say it checks access: ask `api-designer`, name it under `Found` | add the check in your route or loader (B2, B3) and test it; ask only if the contract is silent on who may act |
| F14 | value the screen needs that the API does not give: ask `api-designer`, do not compute it | compute it on the server in your half, if the contract names the field; if it does not, ask `api-designer` (B1/F1) |
| frontend boundaries "wiring to the real API ... `integration`" | build against a fake network, keep the glue small | the wiring is yours; there is no integration task |
| frontend Procedure step 5 | network faked at its boundary, never the real server | the screen tests may fake the network, but S-1's test runs the real handler |

Without a reading of this, a fullstack agent follows F11 literally and asks a Consultation about its own route, or
reports under `Found` a hole it was meant to close.

**S-6. Errors are tested on each side, never across.** B6 tests the status and body of every named error at the route;
F3/F9 test the client's error states with a faked response. Nothing ties them: a server that returns
`{error:{code:"name_taken"}}` and a client that reads `body.message` both pass. In a fullstack Slice the agent owns
both, so the error a scenario names should be driven once from the screen through the real handler.

**S-7. Fresh data after a write.** After a mutation the screen must show what the server stored (trimmed,
normalized, with its generated id), not what the user typed: `revalidatePath` (Next.js, `stacks/nextjs.md:38` [V]),
query invalidation, or the response body. F8 says server data lives in one place, but not that the place is refreshed.
`react-rules` says "after a mutation, revalidate" [V] only for React and is a skill, not a checked rule.

**S-8. Order of work.** Neither Role says what to build first when both halves are yours. Two common failures [M]:
screen first against an imagined shape (then the server is bent to fit it, or the client keeps a mapper); or the
server finished and the screen never wired (a fake that stays). Outside-in from the scenario (one failing test across
the seam, then the server half behind its own tests, then the screen against what the server really returns) gives the
seam test from S-1 for free.

**S-9. Design wiring gaps.** Fullstack inherits F2 ("ask `ui-ux-designer` as a Consultation") but `ui-ux-designer` is
not in its `consults:`, so the Consultation would be refused (`aidw consult` checks the pair, ADR-0013). Its `reads:`
lack `design-direction`, which frontend reads. Its skills list lacks `library/react-rules`, which frontend lists.

**S-10. Scaffold and Role-less tasks.** The scaffold task is fullstack's. Neither rule table says what a scaffold
must leave behind: one Verify command that runs both halves' tests, a test harness each half can use (jsdom and the
server's in-process HTTP helper), the env names in `.env.example`, no feature code. The Technical Planner's table
(line 119) lists the files, not the done state.

**S-11. No report or done-when of its own.** The backend and frontend report templates each have one half's lines
(routes and access tests; screens and states). A fullstack reply needs both plus the seam.

**S-12. No scripts of its own, none pointed at.** The body points at both Roles' skills but at neither Role's
scripts. Both sets work on any diff (`aidw plugin-path roles/<id>/scripts/<name>.mjs`).

### 2.1 Overlaps (keep one owner)

| Topic | Owner | What fullstack does |
|---|---|---|
| Rules of each half | backend (B1-B15), frontend (F1-F16) via `follows_rules` | applies both; its own rules cover only the seam |
| Contract design, error shape, list limits | `api-designer`, `library/skills/api-design-rules` | builds against it; a hole is asked, never guessed |
| Schema, migrations | `database` task (B15, `aidw analyze` refuses database paths in a non-database task) | data access only |
| The glue of a split Slice, Wave merge conflicts | `integration` | not involved; in its own Slice the glue is its own |
| React/Next habits (`'use client'`, revalidate, server actions validate) | `library/react-rules`, stack packs | cites them; S-3, S-4, S-7 make the stack-neutral version checkable |
| Statistics | `aidw stats` credits a B or F id to backend or frontend (`follows_rules` does not count, `src/stats.ts:92` [V]) | own X ids are credited to fullstack |

---

## 3. Proposed rules X1 to X7 (`roles/fullstack/rules.md`)

Each binds only when the Slice has both halves in the task's Touches (a server-only or screen-only fullstack task is
judged by the B or F table alone).

| id | rule | applies when | checked by |
|---|---|---|---|
| X1 | Each scenario whose WHEN is a user action has at least one test that crosses the seam in process: it drives the client (the rendered screen, or the client's request function) and the real server handler answers, with only outside services and the clock faked; where the stack cannot render the screen in a test (an async Server Component), a contract test runs the same shape against both halves. | the task builds both a server half and a client half of one scenario | reviewer |
| X2 | A request or response shape the client and the server both use is written once (a shared schema or type with a runtime check) and imported by both, or pinned by a contract test both halves run; the shared module imports nothing server-only, so a client file can import it (F10). | the task adds or changes a shape both halves use | reviewer |
| X3 | Data the server half hands to client code without a route (Server Component props to a client component, a `load` return, a page payload, a server action's return) is built from an explicit shape that names its fields, never a row, entity or whole user object (B5 for the seam). | the server half passes data to client code | reviewer |
| X4 | A loader, page or Server Component that reads a record a user may not see checks access on the server before it reads (B2 and B3 for pages), and has the three access tests or the stack's equivalent; a client redirect is the convenience F11 allows, never the check. | the task adds or changes server code that renders a restricted page or reads a user-owned record for one | reviewer |
| X5 | When your Touches hold the server half, the inherited "ask `api-designer`" in F11 and F14 means: close it in your half (the access check, the computed field) when the contract names it; ask `api-designer` only for what the contract does not name (B1, F1); a hole in server code outside your Touches goes under `Found`. | the task holds both halves and an F11 or F14 case arises | reviewer |
| X6 | Every error a scenario names reaches the user as the client state F3 or F9 asks for, proven once through the seam (X1's test or the contract test): the client reads the field the server's error body really carries. | the task adds or changes an error path a scenario names, on both halves | reviewer |
| X7 | After a write the screen shows what the server stored, not what was typed: it revalidates, invalidates the cached read, or renders the response; a test asserts a value the server changes (a trimmed name, a generated id, a new total). | the task adds or changes a write that a screen of the task shows | reviewer |

Not proposed as rules (role.md text instead): the order of work (S-8, a Procedure step), the scaffold's done state
(S-10, a short section), the report.

---

## 4. Proposed skills

### K1. `seam-test` (recommended)

How to write X1's test per stack, with the right/wrong pair R3 requires:
- Vite or another SPA + a Node server (Express, Fastify, Hono): the client's `fetch` is answered by the real app in
  process (an MSW handler that forwards `/api/*` to the app's in-process request helper, or the client's base URL pointed
  at an in-process adapter), never a socket; the database is the project's test database (PGlite, SQLite in memory).
- Next.js: call the Server Action or route handler as a function with a test session; render the client component with
  the action's real return; the async Server Component itself is covered by a contract test on the data it builds.
- SvelteKit and Nuxt: call `load` / the server route with a test event, render the component with its return.
- Wrong: the screen test fakes the response with a body the server never sends; the route test and the screen test
  each pass and the scenario does not work.

### K2. `server-to-client-data` (recommended)

X3, X4, X7 in one place: the shape handed across (props, `load`, payload), the access check in the page's server code,
revalidating or invalidating after a write, and keeping server-only modules out of client imports (F10, X2). Right/wrong
pair: `<ProfileCard user={user} />` with a row against `<ProfileCard user={toProfileView(user)} />`.

### K3. `library/contract-tests` (move, recommended)

Move integration's `contract-tests.md` to `library/skills/contract-tests/` and list it for both integration and
fullstack (load when the Slice has a shape both halves use and X1 cannot render the screen). Same move as R5 made for
`external-api` and `resilient-integration`.

### Also to wire (not new)

- `library/react-rules` in fullstack's skills with frontend's load condition (S-9).
- The five backend and five frontend scripts listed in role.md with the condition each Role already gives (S-12).

Looked at and not proposed: a separate `scaffold` skill (the Technical Planner and stack packs already list the files;
a short role.md section is enough); copying either Role's skills into fullstack (pointers keep one owner).

---

## 5. Scripts

No new script is proposed now. A seam script (`shape-drift`: fields the client reads from a response against the
fields the server's response builder names) is tempting, but a regex over two languages of object access would be
noisy; decide after the level 2 fixture shows whether X2/X6 failures are common. Fullstack runs the existing ten by
condition (S-12).

---

## 6. role.md changes

1. Front matter: add `ui-ux-designer` to `consults` (keep `database-architect`: fullstack writes data access);
   add `design-direction` to `reads`; add `library/react-rules`, `seam-test`, `server-to-client-data`,
   `library/contract-tests` to `skills`.
2. A boundaries and hand-off table (frontend's and backend's rows merged, with the X5 readings; `integration` only for a
   split Slice; schema to `database`).
3. Procedure, outside-in: (1) read brief, contract, design, two existing screens and routes; (2) mark the rules of all
   three tables that apply and read the skills whose conditions fit; (3) ask for holes now; (4) write X1's failing test;
   (5) the server half behind its own route tests (B2, B6); (6) the screen against what the server returns (F3-F6);
   (7) make X1 pass, run the scripts that fit, run every Verify.
4. A short "Scaffold task" section (S-10): one Verify that runs both halves, a test harness each half can use, env names
   in `.env.example`, no feature code.
5. Done when and a Report template with both halves and the seam:
   `Works now`, `Server` (routes, access tests n/n, errors tested n/n), `Screens` (states n/n, overlays n/n),
   `Seam` (the crossing test per scenario, or the contract test), `Files`, `Verify`, `Rules` (B, F and X ids),
   `Scripts`, `Asked`, `Owed`, `Found`.

---

## 7. Proposed level 1 cases

Each case `covers:` only X rules and fullstack's own skills (B and F rules are covered by their own Roles).

| # | case | trap | covers |
|---|---|---|---|
| E1 | `seam-test-crosses` | Vite + Express "rename project": the obvious plan is a route test plus a screen test with MSW returning a hand-written body | X1, seam-test |
| E2 | `one-shape-not-two` | the client form and the server both need the invite schema; the existing `lib/invites.ts` imports the db client | X2, contract-tests |
| E3 | `profile-props-are-a-response` | Next.js page passes the `user` row (with `passwordHash`, `stripeCustomerId`) to a `'use client'` card | X3, server-to-client-data |
| E4 | `page-checks-access` | Next.js `/projects/[id]` Server Component reads by URL id; the nav hides the link by role | X4 |
| E5 | `own-both-halves` | owner-only billing screen; the route in Touches lacks a check (close it), a sibling route outside Touches too (`Found`) | X5 |
| E6 | `error-reaches-the-field` | server returns `422 {error:{fields:{name:"taken"}}}`, the existing client helper reads `body.message` | X6 |
| E7 | `fresh-after-write` | rename trims and the list is cached; the obvious code sets the typed value into state | X7 |
| E8 | `field-the-contract-lacks` (`expect: ask`) | the screen needs `seatsLeft`, the contract does not name it; the agent owns the server and is tempted to just add it | X5 (ask half) |
| — | `test-first-within-touches` (existing) | revise: add `covers: []`, keep as the generic case | — |

8 new + 1 revised = 9 cases × 3 runs = **27 level 1 calls**. Per C3 as amended, bare and `--without` runs on the deep
tier are diagnostic only; propose none unless a case passes trivially.

---

## 8. Level 2

### 8.1 Fixture options

| Option | What | For | Against |
|---|---|---|---|
| **A. new `fullstack-app`** (recommended) | one repo: Vite + React 19 client (`web/`) and Express 5 + PGlite server (`server/`), shared `shared/` schemas (zod); Vitest with two projects (jsdom for `web`, node for `server`); in the jsdom tests MSW forwards `/api/*` to the Express app through the in-process `http.ts` from `backend-api` | the seam is real: X1, X2, X6, X7 are graded by held-out tests that drive the screen into the real server; reuses both existing fixtures' parts and cache path; no socket, sandbox stays closed | a third fixture to keep; install is the union of both (React, jsdom, MSW, Express, PGlite) |
| B. Next.js App Router fixture | client + server actions in one app | the most common real fullstack stack; X3/X4 testable | async Server Components do not render in Testing Library (frontend report §7.1 [V]); `next build` slow, install large; server actions tested as functions only |
| C. reuse `frontend-web` + `backend-api` side by side | two folders, no shared code | no new fixture | no real seam: the client still talks to MSW bodies; tests the halves, not fullstack |

X3 and X4 (Next-specific) stay level 1 only under A.

### 8.2 Cases on A (pilot first)

- **L1 `rename-a-project` (pilot)** · covers X1, X6, X7, seam-test. Trap: the existing project screen fakes responses
  in its tests; the server trims names and returns `422` with field errors. Held-out: type a name with spaces, save,
  the list shows the trimmed name from the server (PGlite row checked); a taken name shows the error under the field
  (`aria-invalid`), from the real handler; a member (not owner) gets the server's `403` shown as a state.
- **L2 `invite-with-one-schema`** · covers X2, contract-tests. Trap: `server/invites/schema.ts` imports the db.
  Held-out: an 81-character name is refused by the client before any request and by the server with the same limit;
  the client bundle graph (a held-out test importing the web entry) does not reach `server/db`.
- **L3 `owner-only-billing`** · covers X5. Trap: `GET /api/billing` in Touches has no owner check; the nav hides
  links by `localStorage.role`. Held-out: member gets `403` from the route and the screen shows "Owners only"; the
  report names the `localStorage` nav under `Found`.

### 8.3 Harness

No harness change expected: `fixture:`, `restore:` (add `web/tests/setup.ts`, `server/tests/http.ts`, the MSW
forwarder), `must_read`, checks and the tool log are reused. The vitest path must accept a workspace config with two
projects; check `src/evallevel2.ts` runs `vitest run --config` on the fixture's root config (it does for both existing
fixtures [V]); one held-out test file per project.

Plan: pilot L1 (at most 6 sessions), then L2 and L3 (6 sessions plus spares); ask before more.

---

## 9. Questions for the owner

1. **Consults and reads.** (a) add `ui-ux-designer`, keep `database-architect`, add `design-direction` to reads;
   (b) mirror frontend (drop `database-architect`); (c) keep today's. **Recommend (a)**.
2. **Own rule set.** (a) all seven X1-X7; (b) core four X1, X2, X5, X6; (c) none, follow B and F only.
   **Recommend (a)**.
3. **Inherited "ask" rules (S-5).** (a) rule X5 plus the reading in the boundaries table; (b) only the table, no rule;
   (c) leave as is. **Recommend (a)**.
4. **Skills.** (a) K1 `seam-test` + K2 `server-to-client-data` + move `contract-tests` to library; (b) K1 only plus the
   move; (c) none new. **Recommend (a)**.
5. **Scripts.** (a) none new; list the ten existing by condition; (b) also `shape-drift` now. **Recommend (a)**.
6. **Order of work.** (a) outside-in: seam test red, server half, screen, seam test green; (b) server first, then
   screen; (c) no order. **Recommend (a)**.
7. **Scaffold task.** (a) a short section in role.md; (b) leave to the planner and stack packs. **Recommend (a)**.
8. **Level 1 cases.** (a) E1-E8 plus the existing revised, 27 calls; (b) only E1, E5, E6, E7 (core), 15 calls.
   **Recommend (a)**.
9. **Level 2 fixture.** (a) new `fullstack-app`; (b) Next.js; (c) reuse both. **Recommend (a)**.
10. **Level 2 plan.** (a) pilot L1 (≤6 sessions), then L2-L3 (6 plus spares), ask before more; (b) all three at once;
    (c) level 1 only for now. **Recommend (a)**.

---

## 10. Sources

All [V] in this session: `plugins/aidw/roles/{fullstack,backend,frontend,integration,technical-planner}/role.md`,
`roles/{backend,frontend}/rules.md`, `roles/integration/skills/contract-tests.md`, `library/skills/react-rules/SKILL.md`,
`stacks/{nextjs,sveltekit,nuxt}.md`, `src/{analyze,roles,skills,stats,evallevel2}.ts`, `workflows/feature.yaml`,
`evals/fixtures/{backend-api,frontend-web}/package.json`, `docs/research/frontend-role.md`, `docs/plans/factory-run-to-pr.md`.
