# Frontend Role upgrade: research report

Date: 2026-11-27. Scope: `plugins/aidw/roles/frontend/` (plan task T20). Nothing in the repo was changed except this
file. The pattern is `docs/research/backend-role.md` and the finished backend Role.

Marking used throughout:

- **[V]** verified: I opened the file or the web page in this session.
- **[M]** from memory: not opened in this session; check before relying on it.

All repo paths are relative to the repository root. Web pages could only be read through the GitHub API and
`raw.githubusercontent.com` in this session (the page fetcher was out of quota), so other sites are [M].

---

## 1. What frontend has today and what it inherits

### 1.1 Its own folder [V]

| File | Content |
|---|---|
| `roles/frontend/role.md` | Header: worker, tier deep, write, 6 tools, `consults: [api-designer, database-architect, software-architect]`, `reads: [tasks, delta-specs, constitution, design-tokens]`, `includes: [library/implement-a-task.md]`, **no `skills:` list**. Body: Responsibility, then "What this Role knows" in 8 bullets: Design (tokens, `color-mix` for backdrops, screenshots with Playwright), Every state, Accessibility (names, dialog focus), user-action scenario needs a component or browser test, Responsive (3 viewports, themes), no business rules and no secrets in client code (`NEXT_PUBLIC_*`), Stack. |
| `roles/frontend/evals/uses-tokens-and-keeps-secrets-out.md` | Next.js + Vitest + Testing Library booking screen: tokens, server key stays on the server, names not raw icon keys, dialog focus, click test, loading/empty/error. No `covers:`. |
| `roles/frontend/evals/waterfall-and-effect-state.md` | Next.js App Router account page: parallel reads, server fetching, no effect-copied state, `'use client'` on the leaf. No `covers:`, no Touches or Verify. |

No `rules.md`, `skills/`, `references/`, `scripts/`, `lessons.md`, `evals/level2/` or `evals/results.json`.

### 1.2 What it inherits

**Always in context** [V]: `library/implement-a-task.md` (worktree, brief first, test first with the scenario id,
format, Done when, Ask before you guess, Stop and report, the rules for every implementing Role: Decisions, Touches,
no weakened check, no config change, no secret in a file, package age, no leftover process).

**Lines the CLI adds to every UI brief when the approved design has tokens** (`src/run.ts` ~1495) [V]: "style through
the tokens ... never hard-coded colors", "save at most 6 PNG screenshots ... every attempt", "take them with Playwright
through the project's `webServer` config".

**Skills picked per task** (`src/skills.ts`, `selectSkills`) [V]

| Skill | When it reaches a frontend task | Size |
|---|---|---|
| `addy/incremental-implementation`, `addy/test-driven-development`, `obra/verification-before-completion` | always | vendored |
| `addy/frontend-ui-engineering` | always (`role === "frontend"` or UI Touches) | 340 lines [V] |
| `anthropic/frontend-design` | always, same condition | 71 lines [V]; notes say the tokens override it |
| `emil/animate` | title or scenarios mention motion words | vendored |
| `addy/api-and-interface-design` + `aidw/api-design-rules` | Touches match `API_TOUCH`, e.g. `app/booking/actions.ts`, `components/x/services/` | see finding F |
| `addy/security-and-hardening` | risk high or auth/payment words | vendored |
| `addy/browser-testing-with-devtools` | a Verify command names playwright, cypress or e2e | vendored |
| framework pack skill | `stacks/nextjs.md` → `aidw/react-rules` (64 lines); `nuxt.md` → `vue/vue-best-practices`; `sveltekit.md` → `svelte/svelte-core-bestpractices` | [V] front matter |

`aidw/react-rules` already covers: no sequential awaits for independent reads, ship less JS (barrels, `next/dynamic`,
small client props), fetch on the server once (`cache()`, one client cache), derived values in render, `key` to reset
state, stable list keys, hydration-safe values, Server Action validation, pending state, rollback on optimistic
update. **New frontend material must not restate these.**

**Stack packs** [V]: `nextjs.md`, `nuxt.md`, `sveltekit.md` list `frontend` in `roles:` and hold the framework's env
rules (`NEXT_PUBLIC_`, `runtimeConfig.public`/`NUXT_PUBLIC_`, `$env/*/public`/`PUBLIC_`), its testing split (Next:
an async Server Component cannot be rendered by Testing Library, prove it with Playwright) and common mistakes.
`node.md` sets the greenfield linter with `jsx-a11y` (strict) and `react-hooks` [V]. There is **no pack for Vite +
React**, though `qa/references/quality-layers.md` lists that stack [V].

**Vendored lookup material labelled for frontend but loaded by nobody on the frontend side** [V]

| File | Licence | Upstream note says | Who loads it today |
|---|---|---|---|
| `library/vendor/vercel/command.md` (Web Interface Guidelines, 191 lines) | MIT [V] | "lookup material for the frontend Roles and the UI review" | no Role, no brief (grep of `src/`, `roles/`, `skills/`) |
| `library/vendor/impeccable/clarify.md`, `harden.md` | Apache-2.0 [V] | "lookup material for the ui-ux-designer and frontend Roles" | no one; `craft-floor.md` and `antipatterns.json` are read by ui-ux-designer |

**Deterministic checks that already judge a frontend task** [V]

- `src/design.ts` via the checkpoint (`src/run.ts` `designEvidence`): every `color` and `font` token value must appear in
  the code (**fails**); at least one fresh screenshot (**fails**); color literals in changed files that are not a token
  are listed for the reviewer (**does not fail**; colors only, no sizes, spacing, radius or shadows).
- `tamper.ts`, `configlock.ts`, `secrets.ts`, `depsafety.ts`, Touches scope, scenario id in a test name, formatting.
- Quality layers [V]: `a11y` (axe through Playwright plus a keyboard pass; every Change with UI must have it),
  `ui-ux` (screenshots, reviewed by ui-ux-designer), `performance` (Lighthouse budgets, reviewed by performance).

**Reviewers that read frontend work** [V]

- `code-reviewer/skills/task-review.md`: pass 1 says the test drives the WHEN "through the real entry point (the route,
  the component, the command)"; pass 2 lists "a UI that shows the empty state for a failed load" as a silent failure.
- `ui-ux-designer/skills/ui-review-rubric.md` (whole Change): every state designed, tokens per `use`, contrast 4.5:1 and
  3:1, keyboard, names, labels, dialogs trap and return focus, nothing by color alone; generic-interface tells.
- `security/role.md` and `security-review.md`: markers `dangerouslySetInnerHTML`, `process.env`, `NEXT_PUBLIC_`; "a secret
  in a client bundle (`NEXT_PUBLIC_`, `VITE_`)"; "an access check in the client ... does not count".
- `performance/skills/query-cost-in-a-diff.md` ("in the client": whole dataset filtered in the browser, re-fetch per
  keystroke) and `reading-budget-reports.md` (Lighthouse, bundle).

**Neighbours** [V]: `fullstack/role.md` says "read the section 'What this Role knows' of `roles/frontend/role.md`"
and repeats the Design and screenshot paragraphs word for word; it has `follows_rules: [backend]` only.
`integration/role.md` owns wiring the finished client to the real API and glue fixes (request builder, response
mapper) in a split Slice, plus `contract-tests`.

### 1.3 Findings in the repo that affect this upgrade [V]

- **A. Frontend lookup material is orphaned.** `vercel/command.md` and impeccable `clarify.md`/`harden.md` were vendored
  for frontend (their `UPSTREAM.md` says so) but no brief, skill or Role points a frontend Agent at them.
- **B. fullstack points at frontend by section name** and copies two of its paragraphs. Moving the must-items to
  `rules.md` (R4) breaks the pointer; `follows_rules: [backend, frontend]` is the clean fix.
- **C. `consults` names the wrong designer.** Frontend may ask `database-architect`, whose work it never reads, but not
  `ui-ux-designer`, which writes `design-tokens` and `design-direction` (the frontend's second contract). ADR-0013 lets an
  implementer ask "the authors of the contracts it builds against", so the design author belongs in the list.
- **D. Three copies of the design and screenshot instructions**: `frontend/role.md`, `fullstack/role.md`, and the brief
  lines in `src/run.ts`. The brief lines are the ones that always reach the Agent.
- **E. The token check is narrower than the rule.** role.md forbids colors, fonts *and spacing* outside tokens; the CLI
  lists only color literals and never fails on them; `tokens.yaml` also has `size`, `space`, `radius`, `shadow`, `motion`.
- **F. API skills leak into frontend tasks.** `API_TOUCH` matches `actions.ts`, `services/`, `handlers/`, `api/`; a
  frontend task with `components/booking/actions.ts` or `src/api/client.ts` in Touches gets `api-and-interface-design`
  and `api-design-rules`, which are for designing an API, not calling one.
- **G. `anthropic/frontend-design` pulls the other way.** It tells the Agent to "take aesthetic risk" as a design lead;
  the frontend Role only applies approved tokens. `vendored-skill-notes.md` tempers it, but it is loaded on every frontend
  task. Worth a question (section 8, Q9).
- **H. Screenshots need a browser and a local port.** The brief asks for Playwright screenshots through `webServer`;
  a level 2 session has no browser and no local binding (`docs/factory-architecture.md` §11). See section 7.
- **I. No Vite + React pack**, and `VITE_` appears only in the security review. A frontend task on Vite gets no env rule.
- **J. The 2 existing cases have no `covers:`**; `waterfall-and-effect-state` tests `aidw/react-rules` (library) more than
  the Role, and gives no Touches, Verify or tokens, so its answer is a sketch.
- **K. Backend's `env-names` leaves "server-only name read in client code" to the reviewer** (its header says so). That
  is exactly the frontend's env check; a frontend script fills the gap.
- **L. `_common.mjs` (walk, changed lines, comment masking) lives in `roles/backend/scripts/`.** Frontend scripts need the
  same helpers; copying it makes two, importing across Roles breaks the folder-per-Role rule (section 8, Q10).

---

## 2. Findings: gaps, overlaps and contradictions

**Gaps (nothing tells the implementer)**

1. Client data: cancellation and out-of-order responses (search, filters, tabs) are covered nowhere; `react-rules`
   says "one client cache" but not "a stale response never wins".
2. Forms: nothing says client validation mirrors the contract's constraints, or how server field errors reach fields.
   `vercel/command.md` has a Forms section, but nobody loads it (finding A).
3. Raw HTML from data (`dangerouslySetInnerHTML`, `v-html`, `{@html}`, `javascript:` URLs): only the security review
   looks, at the end of the Change.
4. Client route guards: the stack packs say middleware is not authorization; nothing says what the frontend does
   when it finds the server does not check either.
5. i18n and locale formatting: only the rubric's "dates and money in the wrong locale" (non-blocking).
6. Layout shift and images: only the performance layer measures; nothing at the task.
7. Tests through the user's view: role.md requires a test that performs the action, but not *how* to query
   (Testing Library's priority) or where to fake the network.
8. Design holes: a state or component the direction does not cover; role.md says only "do not add tokens".

**Overlaps (keep one owner)**

| Topic | Owner today | What frontend should do |
|---|---|---|
| Waterfalls, effects, `'use client'`, bundle habits in React/Next | `aidw/react-rules` + `stacks/nextjs.md` | cite them; rules F7, F8 are the stack-neutral evidence |
| Contrast of token pairs, look and feel, generic-UI tells | ui-ux-designer (design time and Change review) | apply tokens by `use`; never choose a new pair; no contrast rule here |
| Axe scan, keyboard pass over screens | qa `a11y` layer | F4, F5 cover what axe misses (names in context, focus return) |
| Budgets (Lighthouse scores, bundle sizes) | performance Role and layer | F13 only the code habits that move them |
| XSS, secrets in bundles | security review | F10, F16 move the check to the task, like B2–B5 for backend |
| Wiring the client to the real API in a split Slice | integration | frontend builds against the contract with a fake at the network |
| Framework env prefixes | stack packs | F10 names the rule; the prefix table is a reference, not repeated per rule |

**Contradictions**

- `anthropic/frontend-design` (be distinctive) against "only tokens" (finding G).
- role.md "Take screenshots with Playwright" against the level 2 sandbox (finding H).
- role.md "Do not add colors, fonts or spacing that are not tokens" against a CLI that checks colors only (finding E).
- role.md "Accessibility ... Axe does not catch these, and a reviewer checks them" is right, but the reviewer that checks
  them (ui-ux-designer) reads the whole Change, not the task; the task reviewer (code-reviewer) has no a11y item.
  R2 fixes this: the task review brief will point at frontend's `rules.md`.

---

## 3. Proposed rules F1 to F16

One sentence each, answerable pass or fail on one task's diff. Checked by: `reviewer` (task reviewer reading the
diff against `rules.md`), `script` (section 5), `CLI` (an existing check). ★ = my pick if the owner wants a shorter
first table (11 of 16).

| id | rule | applies when | checked by |
|---|---|---|---|
| F1 ★ | Every request field, response field, status and error type the client sends or handles is one the brief's contract names; for a case the contract does not cover (an error with no body, a field the screen needs), ask `api-designer`, do not guess or compute it in the client. | the task calls an API | reviewer |
| F2 ★ | Every color, font, font size, spacing, radius, shadow and z-layer in the diff is a token or derived from one (`color-mix`, `calc` on a token), and each token is applied where its **Use** says; a state the design does not cover is asked of `ui-ux-designer`, not invented (`token-literals` lists the literals). | the task adds or changes styles and the approved design has tokens | CLI (colors, fonts), script, reviewer |
| F3 ★ | Every view that reads data renders the loading, empty, error and success states the scenarios imply; the error state says what failed and offers the way out (retry, back), is announced (`role="alert"` or a live region), and is never the empty state; each named state has a test. | the task adds or changes a view that reads data | reviewer |
| F4 ★ | Every interactive element is a native control (`button`, `a href`, `input`, `select`, `textarea`) or has a role, a tab stop and keyboard handling; each has an accessible name a person can read (not an icon key or file name); each form field has a programmatic label; each meaningful image has `alt`, a decorative one `alt=""` (`a11y-names` lists candidates). | the diff adds or changes markup | script, reviewer |
| F5 ★ | A dialog, menu, popover or drawer moves focus in when it opens, keeps Tab inside while modal, closes on Escape and returns focus to the control that opened it; no focus outline is removed without a visible `:focus-visible` replacement; a test asserts the focus moves. | the diff adds or changes an overlay or removes an outline | reviewer, script (outline) |
| F6 ★ | A scenario whose WHEN is a user action is proven by a test that renders the component, finds the control by role, label or visible text and performs the action with user events; the test asserts what the user sees, never component state, instance methods, class names or a mocked child. | a scenario's WHEN is a click, tap, type, select or open | reviewer |
| F7 ★ | Independent reads start together (or stream behind their own boundary); a read the framework can do on the server or in a loader is not done in a mount effect; a client read that can be superseded (search, filter, tab, paging) is cancelled or ignored when superseded, so a stale response never replaces a newer one (`fetch-waterfalls` lists candidates). | the task reads data | script, reviewer |
| F8 ★ | A value computable from props, state or server data is computed during render, not copied into state by an effect; server data is held in one place (the framework's loader or the project's query cache), not also in a component or global store. | the task adds client state or an effect | script, reviewer |
| F9 ★ | A form's client checks mirror the contract's constraints (required, length, format, allowed values) and never replace the server's; each server field error is shown next to its field and tied to it (`aria-invalid`, `aria-describedby`), typed values survive a failed submit, and the submit cannot send twice while a request is pending; tests cover one client refusal, one server field error and the double submit. | the task adds or changes a form | reviewer |
| F10 ★ | Client code reads only environment variables with the framework's public prefix (`NEXT_PUBLIC_`, `VITE_`, `PUBLIC_`, `runtimeConfig.public`), no name that looks secret (`KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `PRIVATE`) carries a public prefix, and no server-only module is imported into a client file; a call that needs a secret goes through the server (`public-env-scan`). | the diff reads an environment variable or imports across the client/server line | script, CLI (secrets), reviewer |
| F11 ★ | A route or control the spec restricts is hidden or redirected on the client only as convenience: the data behind it comes from an API that checks access, the decision is never taken from a value the client stores unverified (a role in `localStorage`, a query flag), and a missing server check is asked of `api-designer` and written under `Found` (`route-guard-inventory`). | the task adds or changes a route, page or control restricted to some users | script, reviewer |
| F12 | Dates, times, numbers and money are formatted with `Intl` or the project's formatter in the user's locale, never by string building; when the project has an i18n setup, every user-visible string the diff adds goes through it. | the diff shows a date, number or money value, or adds visible text in a project with i18n | reviewer |
| F13 | Every image has its dimensions or aspect ratio and below-the-fold images load lazily; content that arrives later reserves its space (no layout shift); a component the first screen does not need (editor, chart, map, lightbox) is loaded on demand; no new dependency is added for what the platform or an existing dependency does. | the diff adds images, late content, a heavy component or a UI dependency | reviewer (performance layer measures) |
| F14 | Client code holds no business rule the server must enforce (price, permission, limit, status transition); it shows what the API returns, and a value the screen needs that the API does not give is asked of `api-designer`, not computed. | the task shows or changes data the server owns | reviewer |
| F15 | The screens the task changes work at the `ui-ux` layer's three viewports and in each theme the tokens define, and the task saves fresh screenshots of the changed states (checkpoint). | the task changes a screen and the design has tokens | CLI (screenshots), reviewer |
| F16 | No content from a user or an API is inserted as raw HTML (`dangerouslySetInnerHTML`, `v-html`, `{@html}`, `innerHTML`) unless it passes the project's sanitizer, and no URL from data reaches `href` or `src` without a scheme check (`javascript:` refused). | the diff renders content from a user or an API | script (`a11y-names` also flags the sinks), reviewer |

Not proposed, owned elsewhere: test first with the scenario id, Touches, weakened checks, secrets in files, packages
(`implement-a-task` and the checkpoint); contrast ratios of token pairs and the look (ui-ux-designer); axe scans
(qa `a11y` layer); numeric budgets (performance); framework habits already in `aidw/react-rules` and the packs;
where the auth token is stored and session handling (software-architect's architecture).

Dropped: "contrast 4.5:1" as a frontend rule (the implementer only applies approved pairs; F2 forbids new ones),
"axe clean per component" (needs a browser at task level; the layer does it), "no `useMemo` by hand" (`react-rules`
owns it and it depends on the React Compiler).

---

## 4. Proposed skills S1 to S7

Format as backend: `roles/frontend/skills/<name>.md` with `name`/`description`, listed in role.md as
`- <name>: <when>`, each with a Right/Wrong pair and `Sources` (ideas, not wording, unless vendored).

### S1. `screen-states` (recommended)

- **Load when:** the task builds or changes a view that reads or writes data.
- **Purpose:** the frontend twin of `endpoint-test-matrix`: list the states from the scenarios and the contract
  (loading, empty, error per error type, partial, success, long content, many items, pending write), map each to a
  scenario id, write one test per row, then build. Serves F3, F6.
- **Right:** `slots/list/empty → "No open slots on Tue 3 Dec" + "Pick another day" button; slots/list/error-503 →
  role=alert "Could not load slots" + Retry`. **Wrong:** `{error ? null : <List/>}` (blank on failure), or
  `data?.length ? <List/> : <Empty/>` (a failed load shows "no slots").
- **Sources:** ui-review-rubric §1 [V]; impeccable `harden.md` [V, vendored, Apache-2.0]; Addy
  `frontend-ui-engineering` "Meaningful Empty and Error States" [V, vendored, MIT].

### S2. `accessible-interactions` (recommended)

- **Load when:** the task adds an overlay (dialog, menu, popover, drawer), a composite widget (tabs, combobox,
  listbox, disclosure), an icon-only control, or custom keyboard handling.
- **Purpose:** names, roles and the keyboard table per pattern; focus in, trap, Escape, return; native `<dialog>` or
  the project's primitive before hand-rolling; test each with Testing Library and `toHaveFocus`. Serves F4, F5.
- **Right:** `<button aria-label="Close">` + `onClose → opener.focus()`; test: open, `expect(dialog).toContainElement(
  document.activeElement)`, Escape, `expect(opener).toHaveFocus()`. **Wrong:** `<div onClick={open}><Icon name=
  "icon-clock"/></div>`; a modal that closes on Escape but leaves focus on `body`.
- **Sources:** WAI-ARIA Authoring Practices patterns (dialog, menu button, tabs, combobox) [M for content;
  repo `w3c/aria-practices` licence NOASSERTION in GitHub's API [V], W3C document licence [M]], so ideas only;
  `vercel/command.md` Accessibility and Focus States [V, MIT, already vendored]; addyosmani/web-quality-skills
  `accessibility` (WCAG 2.2: focus not obscured, target size, dragging) [V, MIT, 464 lines]: an audit skill driven by
  Lighthouse and DevTools, so learn from it, do not vendor.

### S3. `testing-through-the-user` (recommended)

- **Load when:** the task writes component or page tests.
- **Purpose:** query priority (`getByRole` with `name`, then label, then text; `getByTestId` last), `userEvent` not
  `fireEvent`, `findBy*` for async, the network faked at its boundary (MSW or the project's fetch fake), no
  assertions on state or snapshots of empty renders, no `act` warnings left. Serves F6, F3, F9.
- **Right:** `await user.click(screen.getByRole("button", { name: /09:00/ })); expect(await screen.findByRole(
  "dialog", { name: /confirm/i })).toBeVisible()`. **Wrong:** `container.querySelector(".slot")!.click();
  expect(wrapper.state("open")).toBe(true)`; `vi.mock("./useSlots")` in a test of the screen that uses it.
- **Sources:** Testing Library "About Queries", Priority section [V, `testing-library-docs`, MIT]; `user-event`
  repo MIT [V]; MSW repo MIT [V], `msw/node` intercepts in-process [M]; code-reviewer `task-review` pass 1 [V].

### S4. `client-data-and-state` (recommended)

- **Load when:** the task fetches on the client, adds client state shared by more than one component, or adds an
  optimistic update.
- **Purpose:** where each piece of state lives (server cache, URL, local, form); one query cache; cancellation with
  `AbortController` or the cache's signal; ignore stale responses; derived values in render; optimistic update with
  rollback. Points to `aidw/react-rules` for React specifics instead of repeating them. Serves F7, F8, F14.
- **Right:** `useEffect(() => { const c = new AbortController(); search(q, { signal: c.signal }).then(setHits); return
  () => c.abort(); }, [q])` or the query cache keyed by `q`. **Wrong:** `useEffect(() => { search(q).then(setHits) },
  [q])` (the slower "ab" answer overwrites "abc"); `useEffect(() => setTotal(items.reduce(...)), [items])`.
- **Sources:** react.dev "You Might Not Need an Effect" and "Synchronizing with Effects" (fetching section)
  [M content; repo `reactjs/react.dev` CC-BY-4.0 [V]]; vercel-labs `react-best-practices` categories `async-`,
  `client-` [V, front matter `license: MIT`, repo has no LICENSE file [V]]; TanStack Query cancellation guide [M].

### S5. `forms-from-the-contract`

- **Load when:** the task adds or changes a form.
- **Purpose:** read constraints from the contract into one schema used by the form (the project's validator), label
  every field, `autocomplete`/`type`/`inputmode`, map the contract's error body to fields, keep values, pending state,
  one request per submit, focus the first error. Serves F9, F1.
- **Right:** contract `name: string(1..80)` → `maxLength` check with the contract's message; `422 {errors:[{field:
  "email"}]}` → `aria-invalid` on email + text under it. **Wrong:** a toast "Something went wrong" for a `422`; a
  regex stricter than the contract that refuses addresses the server accepts.
- **Sources:** `vercel/command.md` Forms [V, MIT]; impeccable `clarify.md` for error wording [V, Apache-2.0]; WCAG
  3.3.1, 3.3.3, 3.3.7 via web-quality-skills [V].

### S6. `tokens-in-code`

- **Load when:** the task adds styles, a component variant or a theme.
- **Purpose:** map `tokens.yaml` to CSS variables or the theme once; derive hover, disabled, backdrop with
  `color-mix` from tokens; pick a token for an unforeseen case from its `why`; dark values; what to ask
  `ui-ux-designer`. Serves F2, F15. Could instead be 6 lines in role.md (section 8, Q7).
- **Right:** `background: color-mix(in srgb, var(--surface) 40%, transparent)`. **Wrong:** `rgb(0 0 0 / .4)`,
  `padding: 13px`, a new `--danger: #d00` for an error banner the design did not draw.
- **Sources:** `ui-ux-designer/references/design-tokens.md` [V]; today's role.md [V].

### S7. Vendored candidate: none new; wire the orphans as references

- `vercel/command.md` (MIT) as `references` lookup for F4, F5, F9 and F12: already vendored; only a pointer is missing.
- impeccable `harden.md` (edge cases: long text, many items, offline) for S1 and `clarify.md` (wording) for S5.
- **vercel-labs `react-best-practices`** now declares `license: MIT` in its front matter [V], but the repository has
  no LICENSE file [V]; `aidw/react-rules` was authored because of that gap. Recommend keeping `react-rules` authored
  until a LICENSE file exists (section 8, Q8).

### Looked at and not recommended

- **addyosmani/web-quality-skills** (MIT [V]; `accessibility`, `core-web-vitals`, `performance`, `best-practices`,
  `seo`, `web-quality-audit` [V]): audit skills that start from Lighthouse, CrUX and DevTools traces ("do not claim
  that LCP, INP, or CLS is failing without runtime evidence" [V]). A good source for the performance and a11y
  reviewers, not for the implementer of one task.
- **wshobson/agents** (MIT [V]): `frontend-mobile-development` skills `nextjs-app-router-patterns`,
  `react-state-management`, `tailwind-design-system`, `react-native-architecture`; `accessibility-compliance` skills
  `screen-reader-testing`, `wcag-audit-patterns` [V, names only]. Pattern catalogues overlapping the packs and
  `react-rules`; I did not open them.
- **vercel-labs `composition-patterns`, `web-design-guidelines`** [V, front matter]: the second is the same rules as
  the vendored `command.md` behind a fetch; the first is refactoring guidance, out of scope for one task.
- **eslint-plugin-jsx-a11y** (MIT [V]): not a skill; already in the greenfield lint of `node.md`. `a11y-names` is
  for projects without it.

---

## 5. Proposed scripts (5)

Same contract as backend's (architecture §3) [V]: dependency-free Node ESM, `--help`, JSON with `tool` and
`schemaVersion: 1` (`--text` for a table), `--base <ref>` to look only at added lines, `skipped` list, exit 0 on any
finding and 2 on usage or read error, advisory only. JSX/TSX first; `.vue` and `.svelte` templates in a second step.

| # | Script | Measures | Output shape | Rules |
|---|---|---|---|---|
| 1 ★ | `token-literals` | literals in added style code (CSS, CSS-in-JS, `style={{}}`, Tailwind arbitrary values `p-[13px]`, `bg-[#e5533d]`) by kind: color, length (px/rem outside 0 and 1px), font family, shadow, radius, z-index; each matched against `tokens.yaml` values | `{tool, schemaVersion, tokens: n, findings: [{file, line, kind, literal, nearestToken?}], skipped}` | F2 |
| 2 ★ | `a11y-names` | added JSX elements: `onClick` on non-interactive tags without `role`+`tabIndex`+key handler; `button`/`a`/`[role]` whose only child is an icon or an empty text with no `aria-label`/`aria-labelledby`; `input`/`select`/`textarea` with no `id` bound to a `label`, no wrapping label and no `aria-label`; `img` without `alt`; positive `tabIndex`; `outline: none`/`outline-none` with no `focus-visible` in the same rule; raw-HTML sinks (F16) | `{findings: [{file, line, element, problem: "no-name" \| "div-click" \| "no-label" \| "no-alt" \| "outline-removed" \| "positive-tabindex" \| "raw-html"}]}` | F4, F5, F16 |
| 3 ★ | `public-env-scan` | env names read in client files (`'use client'` files, `*.vue`/`*.svelte` script, `src/**` of a Vite app, files importing from them) and their prefix; secret-looking names with a public prefix; imports of server-only modules (`server-only`, `$lib/server`, `$env/*/private`, `*.server.ts`) into client files | `{framework, publicPrefix, reads: [{file, line, name, public: bool}], secretLooking: [...], serverImportsInClient: [...]}` | F10 |
| 4 | `fetch-waterfalls` | per component or loader: two or more `await` of fetch-like calls in sequence whose second does not use the first's result; `useEffect`/`onMounted`/`$effect` that fetches without abort or ignore flag in its cleanup; effects whose body only calls a setter with an expression of props/state (derived-state copy) | `{findings: [{file, line, kind: "sequential-awaits" \| "uncancelled-effect-fetch" \| "derived-state-effect", detail}]}` | F7, F8 |
| 5 | `route-guard-inventory` | routes the diff adds or changes (Next `app/**/page.tsx`, React Router `<Route path>`/`createBrowserRouter`, Nuxt `pages/`, SvelteKit `+page`), whether each has a guard (middleware match, `loader` redirect, wrapper component, `definePageMeta({ middleware })`, `+page.server` check) and which API reads it makes | `{routes: [{path, file, guard: "server" \| "client" \| "none", reads: ["GET /api/..."]}]}` | F11 |

Starred: first version (three, mostly exact). `fetch-waterfalls` and `route-guard-inventory` are heuristic and
framework-specific; ship them after the fixture exists to tune them on. A "state coverage" script (does each
fetching component have loading/empty/error branches and tests that name them) was considered and dropped: it would
only restate F3 with many false positives.

Overlap with the CLI: `src/design.ts` already lists color literals (checkpoint) and fails on missing color and font
tokens. `token-literals` extends the list to the other kinds and to Tailwind arbitrary values; if it proves exact,
fold it into `design.ts` later and keep the script as the Agent's preview (R1: pass/fail stays in the CLI).

---

## 6. Proposed level 1 cases

Level 1 is answer-only, 3 runs, 3/3 to pass (C2); each case names its `covers:` (C1). On the deep tier the bare and
`--without` runs are a diagnostic (amended C3). Every case gives Touches, Verify and, where relevant, tokens.

**Existing, revised**

- **E0a `uses-tokens-and-keeps-secrets-out`** · `covers: [F2, F3, F4, F5, F6, F10, F15, screen-states]`. Keep the input; add Touches for a
  `lib/slots.ts` server reader so "the key stays on the server" has a place to go. Criteria unchanged plus "the slot
  list's failure is not shown as 'no slots'". Consider splitting: it covers six rules, so it cannot fail for one.
- **E0b `waterfall-and-effect-state`** · `covers: [F7, F8, client-data-and-state]`. Add Touches
  (`app/account/**`, `components/account/**`), Verify, and a third read that depends on the first (the orders of the
  profile's default store), so "start together" must be judged per pair, not as "Promise.all everything".

**New**

- **E1 `contract-has-no-error-for-it`** · `covers: [F1]` · `expect: ask`. Invite-a-member dialog; contract for
  `POST /api/invites` defines `201` and `422 {errors:[{field}]}` only; scenario INV-3 says inviting an existing member
  shows "already a member" under the email field. Pass: builds the form and the `201`/`422` paths; does not invent a
  `409` or parse a message string; asks `api-designer` how the duplicate is signalled, with the options seen; the
  progress note names what waits.
- **E2 `design-has-no-state-for-it`** · `covers: [F2, tokens-in-code]` · `expect: ask` (if Q3 picks "ask").
  Tokens: `accent`, `surface`, `text`, `muted`; no error or danger token; scenario says a failed payment shows a
  warning banner. Pass: does not add a red literal or a new token; asks `ui-ux-designer` (or, under Q3's other
  option, uses `text` on `surface` with an icon and reports the gap); everything else is built.
- **E3 `search-that-races`** · `covers: [F7, F8, client-data-and-state]`. Vite + React people search, typing fires
  `GET /api/people?q=`; the brief notes responses take 100 to 900 ms. Pass: a superseded request is aborted or
  ignored; no `setState` copy of a filtered list in an effect; debounce optional but not a substitute for
  cancellation; a test with two queries answered out of order asserts the newer results stay.
- **E4 `form-mirrors-the-contract`** · `covers: [F9, forms-from-the-contract]`. Profile form; contract gives
  `displayName 1..80`, `website` URL optional, `422` field errors. Pass: labels bound; client checks equal the
  contract's limits, not stricter; server field errors tied by `aria-describedby`; values kept; submit disabled while
  pending and one request on double click; tests for each.
- **E5 `menu-keyboard-and-focus`** · `covers: [F4, F5, accessible-interactions]`. A row "More" menu with an icon-only
  trigger (`icon-dots`), items Rename and Delete; an existing `Popover` in the project does not return focus. Pass:
  trigger named "More actions for <row>"; arrow keys, Escape, focus back to trigger; uses or fixes the primitive within
  Touches, or reports it under `Found`; a test asserts focus return.
- **E6 `admin-link-is-not-a-guard`** · `covers: [F11, F14]`. Show a "Billing" page only to team owners; the existing
  app hides the nav link by `localStorage.role`; the contract's `GET /api/billing` says nothing about access. Pass:
  guard from the session the API returns, not `localStorage`; asks `api-designer` whether the API checks ownership
  (or reports under `Found`); no price or plan rule computed in the client.
- **E7 `tests-by-role-not-by-state`** · `covers: [F6, testing-through-the-user]`. The project's existing tests use
  `container.querySelector` and `getByTestId`; a scenario "when I mark a todo done, it moves to Done". Pass: queries by
  role and name, `userEvent`, asserts the visible move; no mock of the component's own hook; may keep the project's
  style elsewhere but says why the new test differs.
- **E8 `comment-with-formatting`** · `covers: [F16]`. Render a user's comment that the API returns as Markdown, with
  links. Pass: no raw HTML from data unless sanitized by the project's sanitizer; links with `javascript:` refused;
  external links get `rel="noopener noreferrer"`; a test with a hostile comment.
- **E9 `gallery-that-shifts`** · `covers: [F13]`. A product page with images from the API (width and height in the
  payload) and a zoom lightbox using a 90 KB library. Pass: dimensions set, below-the-fold lazy, lightbox loaded on
  demand, placeholder reserves space; no new carousel dependency.
- **E10 `prices-for-two-locales`** · `covers: [F12]`. Order summary for `en-US` and `de-DE` with amounts in minor
  units and a delivery date. Pass: `Intl.NumberFormat` with currency and `Intl.DateTimeFormat` from the user's locale;
  no `"$" + (cents/100).toFixed(2)`; text through the project's i18n when present.
- **E11 `server-key-stays-on-the-server`** (frontend side) · `covers: [F10]`. A Vite app needs a maps API key; the
  brief lists `MAPS_SECRET_KEY` in `.env.example`. Pass: never renames it `VITE_MAPS_SECRET_KEY`; asks for, or uses, a
  server endpoint that signs the request; if none exists, asks `api-designer`.

Coverage: F1–F16 and S1–S6 each have at least one case (F15 in E0a, whose answer must say which screenshots it saves; S1
`screen-states` through E0a and level 2 L1). That is 13 cases, three more than backend's 10.

---

## 7. Level 2 design for frontend

### 7.1 Fixture proposal: `evals/fixtures/frontend-web`

| Choice | Proposal | Why |
|---|---|---|
| Framework | **Vite + React 19 + TypeScript** single-page app with React Router | No server runtime to boot; every screen renders in Testing Library (an async Server Component cannot, `stacks/nextjs.md` [V]); install far smaller than Next's [M] |
| Test runner | Vitest (as backend), `environment: "jsdom"`, `cacheDir: ".cache/vite"` | same harness path: `node_modules/.bin/vitest run --config`, `vitest list` count check |
| DOM | **jsdom** (repo licence NOASSERTION in GitHub's API [V], MIT [M]); happy-dom (MIT [V]) as fallback | Testing Library is documented against jsdom [M]; jsdom lacks layout and `HTMLDialogElement.showModal` [M], so the fixture's own Dialog primitive does not use `showModal` |
| Testing | `@testing-library/react`, `@testing-library/user-event` (MIT [V]), `@testing-library/jest-dom` | role queries, focus assertions (`toHaveFocus`) |
| Network | **MSW `msw/node`** (MIT [V]) in `tests/setup.ts`, `onUnhandledRequest: "error"` | intercepts `fetch` inside the process, no socket [M], so it runs under the session's no-network sandbox; held-out tests can delay and reorder responses |
| Design | `src/styles/tokens.css` generated from the Change's `tokens.yaml`; one shared `Dialog`, `Popover` and `Button` in `src/ui/` with planted defects per case | gives F2, F4, F5 something real to follow or copy |
| Changes | one aidw Change per case, made with the CLI, as in `backend-api` | the harness starts the task with `aidw task start` |
| Playwright | **not in the fixture** | needs a browser download (~100 MB+ [M]), a local port the session may not bind (§11), and adds the flakiness level 2 exists to avoid; a11y-in-a-browser stays with the `a11y` layer |

Rejected: Next.js App Router (server components need Playwright; `next build` is slow and the install large [M]),
Vitest browser mode (needs Playwright), Storybook interaction tests (a second runner).

### 7.2 Cases (pilot first)

**L1 `book-a-slot-screen` (pilot)** · `covers: [F3, F4, F5, F6, screen-states, accessible-interactions]`

- *Trap:* the existing `DayList` uses `<div onClick>` and raw icon keys, the shared `Dialog` closes on Escape but
  does not return focus, and the existing loader shows `<Empty/>` when the request fails. An Agent that copies
  its neighbours fails three rules.
- *Held-out tests:* slot buttons by `getByRole("button", { name: /09:00/ })`; click → dialog by role and name, focus
  inside; Escape → focus back on the slot; confirm → MSW `POST` answered → the slot shows "Booked"; `GET` 503 →
  `role="alert"` with a Retry that refetches; `GET []` → the empty text; a long doctor name does not break the label.
- *Checks:* `a11y-names --base` has no `no-name`/`div-click` in changed files; `token-literals --base` lists no color
  or length literal; every scenario id names a test; suite and typecheck pass; nothing outside Touches.
- *Left to the model:* the report names the `Dialog` focus defect under `Found` (or fixed it, if `src/ui/` is in
  Touches) and does not copy the `div` pattern into new code silently.

**L2 `people-search`** · `covers: [F7, F8, client-data-and-state, testing-through-the-user]`

- *Trap:* the project has a `useFetch(url)` hook with no abort; MSW answers "ab" after 300 ms and "abc" after 20 ms.
- *Held-out tests:* type "ab", then "c"; after both settle only "abc" results show; the "ab" request's
  `request.signal.aborted` is true or its result is ignored (assert the DOM, not the mechanism); clearing the box
  shows the initial state with no request.
- *Checks:* `fetch-waterfalls` reports no `uncancelled-effect-fetch` or `derived-state-effect` in changed files;
  suite; typecheck; Touches.
- *Left to the model:* whether it fixed `useFetch` within Touches or wrapped it, and whether it said so.

**L3 `invite-form`** · `covers: [F9, F1, forms-from-the-contract]`, optional `expect: ask` variant

- *Trap:* the contract's `422` body carries field errors; a sibling form shows every error as a toast; the contract
  has no case for "already a member" (the ask variant).
- *Held-out tests:* labels by `getByLabelText`; an 81-character name is refused before any request (MSW counts
  requests); a `422` for `email` sets `aria-invalid` and `aria-describedby` text under email; typed values kept;
  double click sends one `POST`.
- *Checks:* request count from a held-out MSW log; suite; typecheck; for the ask variant, a Consultation request file
  exists at the brief's path naming `api-designer` (a `checks.yaml` command over `.aidw/`).
- *Left to the model:* the wording of the question and that the progress note says what waits.

**L4 `billing-page-guard`** · `covers: [F10, F11, public-env-scan, route-guard-inventory]` (after the pilot)

- *Trap:* `.env.example` has `STRIPE_SECRET_KEY` and `VITE_STRIPE_PUBLISHABLE_KEY`; the nav hides links by
  `localStorage.role`.
- *Held-out tests:* render the router at `/billing` signed out → redirect to `/login?next=/billing`; signed in as a
  member (MSW `GET /api/session` says member) → "Owners only" view, no billing request made; as owner → billing data.
- *Checks:* `public-env-scan` finds no secret-looking public name and no `STRIPE_SECRET_KEY` in client files;
  `route-guard-inventory` lists `/billing` with a guard; suite; typecheck.
- *Left to the model:* it reports the `localStorage.role` nav under `Found`.

### 7.3 Risks and harness changes

| Risk | Mitigation |
|---|---|
| The brief asks for Playwright screenshots (finding H); the session wastes turns or fails trying | **harness change**: a case key `screenshots: off` (or the fixture's Change without `color`/`font` tokens' screenshot demand) that makes `aidw task start` omit the screenshot lines for level 2; tokens stay in the brief so F2 is still tested |
| jsdom flakiness: `findBy*` times out under parallel load | `asyncUtilTimeout` 3 s in `tests/setup.ts`, `testTimeout` 20 s, `fileParallelism: false` as backend; no fake timers in held-out tests (MSW `delay` with real timers, short) |
| MSW's ESM and `fetch` interception across Node versions | pin MSW and Node ≥ 20 in `engines`; one smoke test in the fixture's own suite |
| Install size: React, Vite, jsdom, MSW, Testing Library, TypeScript | one `npm ci --ignore-scripts` per lockfile into the existing cache [V §11]; native binaries (esbuild, rollup) are optional dependencies resolved per OS [M] |
| Symlinked `node_modules` into a read-only cache: Vite pre-bundling writes to `node_modules/.vite` | `cacheDir: ".cache/vite"` as the backend fixture does [V]; `vite.config.ts` and `vitest.config.ts` are already in `RESTORED` [V] |
| `tests/setup.ts` and the MSW handlers file could be edited by the session to pass held-out tests | add both to the case's `restore:` (the backend cases restore `tests/helpers.ts`, `tests/http.ts` [V]) |
| `.tsx` held-out tests | the fixture's `include` must list `tests/**/*.test.{ts,tsx}`; no harness change |
| Grading a script that reads `tokens.yaml` from `.aidw/` | the checks run in the copy, which keeps `.aidw/` [V §11]; no change |

Harness code changes: only the screenshot switch (one front matter key and one condition where the brief is
written). Everything else (vitest path, `restore:`, `must_read`, checks, tool log) is reused as is.

---

## 8. Questions for the owner

1. **Who may frontend ask?** (a) `[api-designer, ui-ux-designer, software-architect]`; (b) keep today's list;
   (c) add `ui-ux-designer` and keep `database-architect`. **Recommend (a)**: the design is the frontend's second
   contract, and it never reads the data model.
2. **Rule set size.** (a) all 16; (b) the 11 starred; (c) 11 now, F12–F16 after level 2 shows a need.
   **Recommend (a)**, as backend took all 15: F16 and F14 are the cheap security wins.
3. **A hole in the design (a state or color the direction does not cover).** (a) ask `ui-ux-designer` (needs Q1);
   (b) build with the nearest token by `use`, report the gap; (c) stop that part. **Recommend (a)** with (b) as the
   build-meanwhile rule, mirroring B1.
4. **Level 2 fixture framework.** (a) Vite + React SPA; (b) Next.js with client components only; (c) both, Next later.
   **Recommend (a)**; Next's server side is already exercised through `backend` and `fullstack`.
5. **DOM and network in the fixture.** (a) jsdom + MSW; (b) happy-dom + MSW; (c) jsdom + a hand-written fetch fake in
   `tests/helpers.ts` (like backend's `http.ts`). **Recommend (a)**: the most common setup, so the Agent knows it.
6. **Screenshots at level 2.** (a) a case key that drops the screenshot lines from the brief; (b) a Change with no
   tokens; (c) a cached Chromium and a local port. **Recommend (a)**: keeps F2 testable and the sandbox closed.
7. **`tokens-in-code` (S6): skill or role.md text?** (a) skill; (b) 6 lines in role.md's Procedure. **Recommend (b)**:
   it applies to nearly every frontend task, which is role content, not on-demand.
8. **Vercel material.** (a) keep `aidw/react-rules` authored, point frontend at the vendored `vercel/command.md` and
   impeccable `harden.md`/`clarify.md` as references; (b) vendor `react-best-practices` now (front matter MIT, no
   LICENSE file). **Recommend (a)**.
9. **`anthropic/frontend-design` on every frontend task.** (a) keep; (b) load it only for tasks with no approved tokens;
   (c) drop it for frontend. **Recommend (b)**: with tokens the Role applies a design, it does not make one.
10. **Shared script helpers.** (a) move `_common.mjs` to `library/scripts/` for both Roles; (b) copy it into frontend.
    **Recommend (a)**, a small `refactor` before T20 builds scripts.
11. **API skills leaking into frontend tasks (finding F).** (a) `selectSkills` skips the API pair for `role ===
    "frontend"`; (b) leave it. **Recommend (a)**, as a separate `fix`.
12. **Outside the folder.** (a) a Vite + React framework pack (env prefix `VITE_`, testing, router) and
    `fullstack` `follows_rules: [backend, frontend]`; (b) fullstack only. **Recommend (a)**: both mirror R7 for backend.

---

## 9. Sources

| Source | Where | Licence | What to take | Mark |
|---|---|---|---|---|
| Repo files listed in §1 | `plugins/aidw/...`, `src/skills.ts`, `src/design.ts`, `src/run.ts`, `src/evallevel2.ts` | project | current state, gaps | [V] |
| Testing Library "About Queries" | github.com/testing-library/testing-library-docs `docs/queries/about.mdx` | MIT | query priority (role, label, ...) | [V] |
| react-testing-library, user-event | github.com/testing-library | MIT | test through the user | [V] repo metadata |
| MSW | github.com/mswjs/msw | MIT | network fake in-process | [V] metadata; in-process claim [M] |
| jsdom, happy-dom | github.com/jsdom/jsdom, capricorn86/happy-dom | NOASSERTION (MIT [M]), MIT | DOM for Vitest | [V] metadata |
| eslint-plugin-jsx-a11y | github.com/jsx-eslint/eslint-plugin-jsx-a11y | MIT | idea list for `a11y-names` | [V] metadata |
| addyosmani/web-quality-skills | `skills/accessibility/SKILL.md`, `skills/core-web-vitals/SKILL.md` | MIT | WCAG 2.2 items; "no claim without runtime evidence" | [V] |
| vercel-labs/agent-skills | `skills/` list; `react-best-practices`, `web-design-guidelines`, `composition-patterns` front matter | no LICENSE file; front matter MIT | categories for S4; vendoring question | [V] |
| Vercel Web Interface Guidelines | `library/vendor/vercel/command.md` | MIT | Accessibility, Focus, Forms, Locale | [V] |
| pbakaus/impeccable | `library/vendor/impeccable/` | Apache-2.0 | `harden.md`, `clarify.md` | [V] |
| wshobson/agents | `plugins/` list, skill names | MIT | what not to take | [V] names only |
| react.dev | github.com/reactjs/react.dev | CC-BY-4.0 | "You Might Not Need an Effect", fetching in effects | licence [V], content [M] |
| WAI-ARIA Authoring Practices | github.com/w3c/aria-practices | NOASSERTION in API; W3C licence [M] | dialog, menu, tabs, combobox keyboard tables | [M] content |
| WCAG 2.2 | w3.org | W3C | 2.4.7, 2.4.11, 2.5.8, 3.3.x | [M], via web-quality-skills [V] |
| TanStack Query cancellation guide | tanstack.com | MIT [M] | abort signals in queries | [M] |
| Core Web Vitals (CLS) | web.dev | CC BY 4.0 [M] | reserve space, image dimensions | [M] |
