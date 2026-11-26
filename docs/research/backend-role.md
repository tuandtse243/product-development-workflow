# Backend Role upgrade: research report

Date: 2026-11-24. Scope: `plugins/aidw/roles/backend/`. Nothing in the repo was changed.

Marking used throughout:

- **[V]** verified: I opened the file or the web page in this session.
- **[M]** from memory: not opened in this session; check before relying on it.

All repo paths are relative to `/Users/tony/Desktop/Learning/product-development-workflow/`.

---

## 1. What backend has today and what it inherits

### 1.1 Its own folder [V]

| File | Content |
|---|---|
| `plugins/aidw/roles/backend/role.md` | Header (worker, tier deep, write access, 6 tools, `includes: [library/implement-a-task.md]`, **no `skills:` list**). Body: Responsibility, then "What this Role knows": validate at the boundary, authorization on every route, secrets stay on the server, errors, migrations (a paragraph that repeats the database Role), tests through the public interface, stack. |
| `plugins/aidw/roles/backend/evals/entity-is-not-a-response.md` | NestJS `PATCH /users/:id`: whitelist DTO, response DTO, ownership from the token, HTTP test with the real pipe. |
| `plugins/aidw/roles/backend/evals/validates-authorizes-and-does-not-leak.md` | `DELETE /api/bookings/:id`: ownership, validate `:id`, no extra columns, test through the route, migration as its own task. |

No `rules.md`, no `skills/`, no `references/`, no `scripts/`.

### 1.2 What it inherits

**Always in the Agent's context** [V]

- `plugins/aidw/library/implement-a-task.md` (included by role.md): worktree discipline, brief first, read the listed skills, test first with the scenario id in the test name, format, Done when, Stop and report, and the rules for every implementing Role: honor Decisions, stay inside Touches, never weaken a check, do not change lint/CI config, no secret in a file, package age and advisory check, no leftover process.

**Loaded per task by the brief** (`src/skills.ts`, `selectSkills`) [V]

| Skill | When | Path |
|---|---|---|
| `addy/incremental-implementation`, `addy/test-driven-development`, `obra/verification-before-completion` | every implementation task | `plugins/aidw/library/vendor/addy/...`, `.../obra/...` |
| `addy/api-and-interface-design` + `aidw/api-design-rules` | Touches match the API path pattern | `plugins/aidw/library/skills/api-design-rules/SKILL.md` |
| `addy/security-and-hardening` | risk high, or auth/payment/permission words | vendor |
| `addy/observability-and-instrumentation` | title or scenarios mention logs, metrics, traces, health checks | vendor |
| `aidw/schema-evolution`, `supabase/supabase-postgres-best-practices` | Touches match the data path pattern | see finding B below |
| `obra/systematic-debugging`, `obra/receiving-code-review` | retry, quality fix, review fix | vendor |
| the framework pack's skills | project framework | `aidw/nestjs-rules`, `fastapi/fastapi`, `aidw/react-rules`, `vue/...`, `svelte/...` |

`aidw/api-design-rules` already covers: resource names, field conventions, methods and status codes, one error shape (RFC 9457), list limits and cursor pagination, `Idempotency-Key` in two lines, `ETag`/`If-Match`, compatibility, and a 5-item "before you report" list. **New backend material must not restate these.**

**Stack packs** (`plugins/aidw/stacks/`) [V]: `node.md`, `python.md` (tooling); framework packs `nestjs.md`, `fastapi.md`, `django.md` (roles backend, fullstack) and `nextjs.md`, `nuxt.md`, `sveltekit.md` (roles frontend, backend, fullstack). They already hold the framework-specific version of validation, response shaping, guards, config, transactions and HTTP testing. There is no pack for Express, Fastify, Hono, Go, Laravel, Rails or Spring.

**Deterministic checks that already judge a backend task** (`src/`) [V, file headers read]

- `tamper.ts`: deleted, skipped or focused tests and suppressions in added lines.
- `configlock.ts`: lint, type-check, CI and hook config locked.
- `secrets.ts`: self-identifying key formats in added lines.
- `depsafety.ts`: every added package looked up (exists, age, advisory).
- scenario id in a test name per task (checkpoint), Touches scope, formatting in the `code` layer.
- `diffcover.ts` / `aidw diff-coverage`: 80% minimum on the lines the Change added.
- Linters by file kind in `plugins/aidw/roles/qa/references/quality-layers.md`: `squawk`, `prisma migrate diff`, `alembic check`, `makemigrations --check`, `oasdiff breaking` on an OpenAPI file.

**Reviewers that read a backend task afterwards** [V]

- `plugins/aidw/roles/code-reviewer/skills/task-review.md`: spec pass, then silent failures, boundaries, data access, fit, tests as code.
- `plugins/aidw/roles/security/skills/security-review.md`: per entry point: who calls, may they touch this record, what input becomes, what leaves, replay and race.
- `plugins/aidw/roles/performance/skills/query-cost-in-a-diff.md`: query per item, unbounded list, missing index, long transaction.

### 1.3 Findings in the repo that affect this upgrade [V]

- **A. Stale Role ids in skill selection.** `src/skills.ts` tests `role === "backend-engineer"`, `"frontend-engineer"`, `"database-engineer"`. The Role ids are `backend`, `frontend`, `database`. A backend task whose Touches do not match the API path pattern (for example `src/bookings/**`, `lib/billing.ts`) gets neither `api-and-interface-design` nor `aidw/api-design-rules`. `src/run.ts` line 351 lists both old and new ids, so it was fixed there but not in `skills.ts`.
- **B. `aidw/schema-evolution` resolves to an empty directory.** `plugins/aidw/library/skills/schema-evolution/` has no `SKILL.md` and is not tracked by git; the text lives in `plugins/aidw/roles/database-architect/skills/schema-evolution.md`. `selectSkills` still adds `aidw/schema-evolution` to every data-touching task, so the brief would point at a file that does not exist. I did not run the CLI to see how the brief handles this.
- **C. `fullstack` points at a section of backend's role.md by name.** `plugins/aidw/roles/fullstack/role.md` says: read the section "What this Role knows" of `roles/backend/role.md`. Moving that content into `rules.md` breaks the pointer unless fullstack is changed too.
- **D. No Role has a `scripts/` folder yet.** `docs/factory-architecture.md` (lines 82 and 308) declares it, but backend would be the first. There is no convention for language, invocation or tests.
- **E. The existing `rules.md` files are a different kind of thing.** The three that exist (code-reviewer, security, ui-ux-designer) each hold 3 bullets about access and verdict behaviour, with no ids and no check method. The "5 to 10 checkable rules" bar is a new format; backend sets the precedent.
- **F. Role evals run without tools.** `aidw eval` runs each case with `claude -p` (no tools) and grades the answer against the criteria (CLI help text). An eval can judge what the Agent says it will do, not code it wrote.

---

## 2. Candidate rules (15)

Each is one sentence and can be answered pass or fail. "Check" says who answers: R = code reviewer reading the diff, S = a Role script from section 4, CLI = an existing check. My 8 picks for `rules.md` are marked with a star; the rest are either better as skill content or depend on an open decision.

| # | Rule | Check | Source |
|---|---|---|---|
| B1 ★ | Every route, field name and status code in the diff is one the brief's contract names; anything else is a stop-and-report, not a choice. | R (task-review pass 1, "Decisions to honor"); CLI `oasdiff` when the project has an OpenAPI file | role.md today [V]; `api-design-rules` [V] |
| B2 ★ | Every new or changed route that takes a record id has three tests: no caller identity, another user's record, the owner. | S `route-inventory` lists routes and the tests that hit them; R confirms the assertions | OWASP API1:2023 Broken Object Level Authorization [V]; `stacks/fastapi.md` Testing [V] |
| B3 ★ | The id that decides ownership or tenancy comes from the session or token, never from the body, query or a header the client sets. | R; S can flag handlers that read a user id from the request | OWASP API1 and API5 [V]; `nestjs-rules` [V] |
| B4 ★ | Every request body, query and path parameter passes a schema that rejects unknown fields before any business code or query runs. | R; the eval `entity-is-not-a-response` already tests it | OWASP API3:2023 property-level authorization [V]; stack packs [V] |
| B5 ★ | A response is built from an explicit response shape; a database row, entity or model is never returned as it is. | R; a contract test asserting no field outside the contract (integration skill `contract-tests`) | OWASP API3 [V]; `nestjs.md`, `fastapi.md` [V] |
| B6 ★ | Each error a scenario names has a test that asserts the status and the body shape, and no response body contains a stack trace, SQL text, a file path or an internal id. | S `error-shape-probe` on captured responses; R | RFC 9457, security considerations [V]; Google AIP-193 [V] |
| B7 ★ | A write that changes more than one row or table runs in one transaction, and no network call is made while that transaction is open. | R (task-review "partial write", query-cost "long transactions") | stack packs [V]; `query-cost-in-a-diff` [V] |
| B8 | A rule that must hold under two requests at once ("at most one", "cannot go below zero") is enforced by the database (unique constraint, conditional update, lock or version), not by read-then-write in code, and has a test that fires two requests. | R; the test is the evidence | `task-review` "read-then-write with no guard" [V]; `stacks/django.md` (`F()`, `select_for_update`) [V] |
| B9 | When a write must also send something (email, event, job, webhook), the send is recorded in the same transaction or runs after commit; it is never the only record that the send is owed. | R | Transactional outbox, microservices.io [V] |
| B10 ★ | Every list a route returns has a default limit, a maximum, and a stable order ending in a unique key, and a test requests more than the maximum. | R; `api-design-rules` checklist | OWASP API4:2023 Unrestricted Resource Consumption [V]; `api-design-rules` [V] |
| B11 | The number of queries a list route runs does not grow with the number of rows; a test asserts the count for 1 row and for N. | S `query-count` helper produces the number; R | `query-cost-in-a-diff` [V]; Django `assertNumQueries` in `stacks/django.md` [V] |
| B12 | Every outbound call (HTTP, queue, mail, storage) sets an explicit timeout and goes through an interface the tests replace. | S `timeout-scan` on added lines; R | `integration/skills/external-api.md` [V]; OWASP API10 Unsafe Consumption of APIs [V] |
| B13 ★ | Every environment variable the diff reads is listed by name in `.env.example` and is read in one validated config module, not inside a handler or service. | S `env-names` (exact, countable) | Twelve-Factor III Config [V]; role.md today [V]; stack packs [V] |
| B14 | No log line the diff adds carries a password, token, session id, authorization header, connection string, or a whole request body or user object. | S `log-leak-scan` (heuristic); R | OWASP Logging Cheat Sheet, data to exclude [V]; OpenTelemetry HTTP conventions on headers and bodies [V] |
| B15 | A diff from a backend task contains no migration or schema file unless the brief's Touches list it; a needed schema change is a stop-and-report. | CLI-shaped: `src/dbpaths.ts` already knows database paths (`touchesDatabase`), and Touches scope is already enforced | role.md today and `roles/database/role.md` [V] |

Not proposed as rules because they already exist elsewhere: test first with the scenario id (implement-a-task + checkpoint), no weakened checks (tamper), no secret in a file (secrets), package safety (depsafety), coverage on the diff (diff-coverage).

Rules I considered and dropped: "p95 under 100 ms" and "coverage above 80%" from the VoltAgent backend-developer agent [V]. The first is not checkable inside one task and belongs to the performance layer's budgets; the second already exists as `aidw diff-coverage`.

---

## 3. Candidate skills (7)

The shared `api-design-rules` is a checklist of *what the API looks like*. The gap is *how to build the server side so the hard cases hold*. All candidates are procedures, not design rules.

Format to follow: a file `roles/backend/skills/<name>.md` with `name` and `description` front matter, listed in role.md as `- <name>: <when>` (the format `roles/database/role.md` and `roles/integration/role.md` use) [V]. Each Authored Skill ends with `Sources` and ships with at least one Role eval (ADR-0005) [V].

### S1. `endpoint-test-matrix` (recommended)

- **Load when:** the task adds or changes a route, a server action or an RPC method.
- **Outline:**
  1. From the contract, write one row per outcome: success, each validation failure, no identity, another user's record, not found, conflict, limit exceeded.
  2. Map each row to a scenario id; rows with no scenario are reported, not invented.
  3. Write the tests through the real entry point with the real validation and error pipeline.
  4. Handler stays thin: parse, authorize, call one function, shape the response, map the error.
  5. Self-check with `route-inventory` before replying.
- **Sources:** OWASP API Security Top 10 2023, API1, API3, API4, API5 [V] (content CC BY-SA 4.0 [M]: the Top 10 page I opened shows only a copyright line; the licence is from memory of the project's repository); obra/superpowers `test-driven-development` [V], MIT [V, local `library/vendor/obra/LICENSE`]; VoltAgent `backend-developer` checklists [V], MIT [V].
- **Recommendation:** authored. Two sources overlap and OWASP cannot be vendored except as unmodified reference.

### S2. `transactions-and-races` (recommended)

- **Load when:** the task writes more than one row or table, or reads a value and then writes based on it (stock, balance, a slot, a counter, a unique name), or a scenario says "at most", "only one", "cannot ... twice".
- **Outline:**
  1. Draw the transaction boundary around the whole business change; nothing slow or remote inside it.
  2. Pick the arbiter: unique or partial-unique constraint, conditional `UPDATE ... WHERE`, a version column, or a row lock; say why.
  3. Map the database's refusal (unique violation, zero rows updated) to the contract's `409`.
  4. Test with two requests at once, and assert exactly one wins.
  5. If the arbiter needs a constraint that does not exist, stop and report: that is a `database` task.
- **Sources:** `supabase-postgres-best-practices` lock references already vendored in the repo [V, directory listed, files not opened]; PostgreSQL documentation on isolation and explicit locking [M]; strong_migrations README on lock timeouts and keeping backfills out of schema transactions [V], MIT [V].
- **Recommendation:** authored. No single public skill covers the implementer's side of this.

### S3. `repeat-safe-writes` (recommended)

- **Load when:** the contract names an `Idempotency-Key` for the route, or a scenario says a retry or a double submit must not act twice.
- **Outline:**
  1. Prefer a natural key when the domain has one (one order per cart); otherwise store the client's key.
  2. Store key, a fingerprint of the request, and the first response, written in the same transaction as the effect.
  3. Same key and same fingerprint returns the stored response; same key with a different payload is `422`; a key still in progress is `409`; a required key that is missing is `400`.
  4. Decide and state how long keys live.
  5. Test: same request twice gives one effect and the same response; changed body is refused.
- **Sources:** IETF draft `draft-ietf-httpapi-idempotency-key-header-09` (active, expires 2027-05-25) [V], IETF Trust terms; Stripe API reference "Idempotent requests" [V] (saves status and body of the first request including `500`, compares parameters, keys may be pruned after 24 hours, nothing saved when validation fails or a concurrent request conflicts), proprietary documentation.
- **Recommendation:** authored. Neither source may be copied; `integration/skills/resilient-integration.md` covers the *client* side of the same key and should be cited, not repeated.

### S4. `effects-after-commit`

- **Load when:** a write must also cause something outside the database: an email, an event, a queued job, a call to another service.
- **Outline:**
  1. Never send inside the transaction, and never send first and save second.
  2. Record what is owed in the same transaction (an outbox row or the project's job table), and let a relay or worker send it.
  3. Delivery is at least once, so the receiver or the send must be safe to repeat.
  4. Small project with no queue: state the after-commit hook used and what is lost on a crash, in the report.
  5. Test: the provider fails and the business change is still saved; the provider is called once after a retry.
- **Sources:** microservices.io "Transactional outbox" [V], "Copyright Chris Richardson, All rights reserved" [V], so ideas only; AWS Builders' Library on retries [M].
- **Recommendation:** authored. Needs a decision first (section 7, question 3): this borders on the `integration` Role.

### S5. `server-logs-and-errors`

- **Load when:** the task adds an entry point or an error path in a project that already has a logger, or the brief asks for logs, a health check or a request id.
- **Outline:**
  1. One place maps errors to the contract's shape; `4xx` is the caller's problem (info or warn), `5xx` is ours (error, logged once with the cause).
  2. Structured fields, not sentences: event name, outcome, route template (not the raw path), request or trace id.
  3. The never-log list: passwords, tokens, session ids, authorization headers, connection strings, payment data, whole bodies.
  4. Logs go to stdout as a stream; the app does not manage log files.
  5. Test one log line and one error body.
- **Sources:** OWASP Logging Cheat Sheet [V], CC BY-SA 4.0 [V] (reference only, never copied into a skill); OpenTelemetry HTTP span conventions [V] (span name from `http.route`, server status unset for `4xx` and Error for `5xx`, headers captured only by explicit configuration) and logs data model [V] (TraceId and SpanId on a log record); licence of the OpenTelemetry site CC BY 4.0 [M], the pages I opened show none; Twelve-Factor XI Logs [V], repository licence CC BY 4.0 [V], though the website itself says "All rights reserved" [V].
- **Recommendation:** authored and small, or dropped in favour of the vendored `addy/observability-and-instrumentation`, which is 224+ lines and loads only when the task title mentions logs or metrics (question 6).

### S6. `query-shape`

- **Load when:** the task adds a query that returns a list, loads a relation, or sorts or filters by a new column.
- **Outline:**
  1. Write the list with its limit, maximum and stable order first.
  2. Load relations in one query (join, `IN`, the ORM's eager load); never per row.
  3. Select the columns the response needs.
  4. Prove it: the `query-count` helper for 1 row and N rows.
  5. A new filter or sort with no index is a note in the report for the `database` Role.
- **Sources:** `roles/performance/skills/query-cost-in-a-diff.md` [V] (the reviewer's side of the same topic); `stacks/django.md` [V]; Prisma and Django documentation on N+1 [M].
- **Recommendation:** authored, or folded into S1 as one step plus rule B11. As its own skill it is thin.

### S7. Vendored candidate: getsentry `secret-serialization`

- **Load when:** the task adds a serializer, a logger call or tracing around an object that holds a credential.
- **What it is:** a skill that finds secrets leaking through serialization, logging or tracing output [V, from the repository's skill list only; I did not open the SKILL.md].
- **Licence:** Apache-2.0 [V, README]; the repo already vendors two getsentry skills under `plugins/aidw/library/vendor/sentry/` [V].
- **Recommendation:** read it before deciding. It may be written as a review skill tied to Sentry's codebase; if so, take the idea into S5 instead.

### Looked at and not recommended

- **wshobson/agents `backend-development` plugin**, MIT [V]: skills are `api-design-principles`, `architecture-patterns`, `cqrs-implementation`, `event-store-design`, `microservices-patterns`, `projection-patterns`, `saga-orchestration`, `temporal-python-testing`, `workflow-orchestration-patterns` [V, names only]. These are architecture choices that belong to the Software Architect, not to an implementer of one task. Its `backend-architect` agent [V] is useful only as a list of implementer-level concerns: timeouts, retries with jitter, idempotency, health checks, correlation ids.
- **obra/superpowers `test-driven-development`**, MIT [V]: stronger wording than Addy's on watching the test fail for the right reason. The repo already loads Addy's TDD skill for every task, and ADR-0005 rejects overlapping skills. Take the "fail for the right reason" idea into S1.
- **anthropics/skills** [V, README only]: nothing aimed at server implementation. Licence per skill not confirmed.
- **github/spec-kit** MIT [V], **BMAD-METHOD** MIT [V], **OpenSpec** MIT [V]: the repository front pages describe the workflow, not how the implementing agent works; I did not open their templates. They are workflow frameworks at the level of aidw itself and add nothing specific to a backend Role.

---

## 4. Candidate scripts (5)

Principle used to sort Role script from CLI check: a **CLI check** is deterministic, applies to every project and may fail a task (ADR-0006). A **Role script** is the Agent's own measuring tool: it may be heuristic, it prints numbers and lists, and the Agent or a reviewer reads them. None of these should fail a checkpoint.

| # | Script | Measures | Input → output | Stack | Why the Role, not the CLI |
|---|---|---|---|---|---|
| 1 ★ | `route-inventory` | Routes the diff adds or changes, and for each the tests that call it | base ref, working dir → JSON and a table: method, path, file, tests found, which of the three access cases (B2) have a test | Per stack pack: one pattern set per framework (Nest decorators, Next route files, FastAPI decorators, Django urls, Express-style calls) | Pattern-based, so it can miss routes; useful as a worklist, wrong as a gate |
| 2 ★ | `env-names` | Environment variable names read in changed code against `.env.example` | base ref → three lists: read but not listed, listed but not read, read outside the config module | Nearly stack-agnostic: `process.env.X`, `import.meta.env`, `os.environ`, `getenv`, settings fields | Exact enough to become a Guard later; start as a Role tool and promote once false positives are known |
| 3 ★ | `error-shape-probe` | Whether error responses match the contract's error shape and leak nothing | a file of captured responses (status, headers, body), written by the tests → per response: missing members, wrong media type, leak markers (stack frames, SQL keywords, absolute paths) | Stack-agnostic | Needs the task's own captured responses; the CLI has no generic way to produce them |
| 4 | `query-count` | Statements run for a list of 1 and of N | a test command and a query-log file → the two counts and the difference | Per ORM: how to turn on the query log (Prisma, Drizzle, SQLAlchemy, Django) | It is a test helper; the measurement only means something inside the test the Agent wrote |
| 5 | `leak-and-timeout-scan` | Added lines that log risky names (B14) or make an outbound call with no timeout (B12) | base ref → file, line, which pattern | Stack-agnostic regex with a small table per language | Heuristic with false positives by nature |

Starred: my recommendation for the first version (three scripts, all measurable, two of them stack-agnostic).

Things to settle before writing any (question 4): no Role has scripts today [V]. Reasonable defaults: plain Node `.mjs` with no dependencies (the plugin already ships Node), invoked by a path from `aidw plugin-path roles/backend/scripts/<name>.mjs`, tested under `tests/` like the CLI, output JSON with a `--text` table.

---

## 5. Candidate evals (4, beyond the existing 2)

Evals run without tools [V], so each criterion must be judgeable from the Agent's written answer.

### E1. `two-requests-one-slot` (tests S2, B8)

- **Input:** a brief: `POST /api/bookings` books a slot; the scenario says a slot holds at most one active booking. The data layer has `findActiveBySlot` and `insert`. Touches are `src/bookings/**` and tests; no migration paths.
- **Pass:** does not rely on check-then-insert alone; names a database arbiter; when the needed unique constraint is missing, stops and reports that it is a `database` task instead of adding a migration; writes a test with two simultaneous requests where exactly one succeeds; the loser gets the contract's `409` shape.

### E2. `contract-has-a-hole` (tests B1 and Stop and report)

- **Input:** a brief with a contract for `POST /api/invites` that defines `201` and `422` only; one scenario says inviting an email that is already a member is refused. The Frontend Role builds the screen in parallel.
- **Pass:** does not invent a status code or an error `type` for the duplicate case; does not rename or add a field; stops and reports the missing case with the options it sees; still writes the tests for the cases the contract does define, or says exactly which work is blocked.

### E3. `email-after-the-order` (tests S4, B7, B9)

- **Input:** a brief: placing an order saves the order and its lines and sends a confirmation email through a mail provider behind `Mailer.send`. A scenario says the order is kept when the mail provider is down.
- **Pass:** order and lines in one transaction; the mail call is not inside it; the owed email is recorded or sent after commit and the choice is stated; the provider is replaced at its boundary; a test makes the provider fail and asserts the order exists; no real network call.

### E4. `list-that-grows` (tests B10, B11, S6)

- **Input:** a brief: `GET /api/projects` returns the caller's projects with each project's member count; the spec says an account may have 5,000 projects. The contract has `limit`, `cursor`, `nextCursor`.
- **Pass:** only the caller's projects (ownership in the query); default and maximum limit, with a test above the maximum; stable order ending in a unique key; the count comes from one query, not one per project; a test asserts the query count does not grow with rows; unknown sort or filter is `400`.

Spare, if a fifth is wanted: `log-with-a-token`: a failing call to a provider must be logged for support; pass is a structured line with the request id and the provider's error class, and no token, authorization header or request body.

---

## 6. Overlaps and conflicts

**With the shared library**

- `api-design-rules` owns the API's shape. Rules B6 and B10 touch the same ground from the "is there a test" side; word them as evidence rules so the two do not drift. S3 must cite its two idempotency lines instead of restating them.
- `implement-a-task.md` owns test-first, secrets, packages and weakened checks. No backend rule should repeat those.
- Finding A (stale ids in `src/skills.ts`) means the shared API skills do not reliably reach backend tasks today. Fixing it is a prerequisite for "backend inherits api-design-rules" being true.

**With stack packs**

- The packs already say "validate with DTOs", "set `response_model`", "one transaction". The rules above are the stack-neutral statement of the same facts; that is duplication by design (ADR-0001 keeps Roles stack-neutral), but the framework examples must stay in the packs only.
- Backend tasks on Express, Fastify or Hono, and on Next.js route handlers, get no backend-specific pack. The Role's rules are the only server guidance they receive, which is an argument for keeping the rules self-sufficient.

**With code-reviewer**

- Its `task-review` pass 2 already looks for partial writes, queries in loops, unbounded lists and unguarded read-then-write. Rules B7, B8, B10 and B11 are the implementer's mirror. Good: a broken rule is a finding the reviewer already raises. Risk: the reviewer does not load `roles/backend/rules.md`, so "checked by reviewer" is only true if the review brief points at it (question 1).

**With security**

- B2 to B5 mirror the security review's entry-point trace. The security Role reviews the whole Change late; the rules move the same checks to the task. No conflict, but B2 (three access tests per route) is stricter than anything the security Role demands today.

**With database**

- role.md has a Migrations paragraph ("if you are given one anyway, follow this") that repeats `roles/database/role.md` and `quality-layers.md`. It contradicts the cleaner line in B15 and in the existing eval ("put any schema change in its own task"). Recommend replacing the paragraph with the stop-and-report rule.
- S2 and S3 both end in "the constraint or the key table is a `database` task". The Technical Planner must know to plan it; `roles/technical-planner/skills/migration-tasks.md` exists [V, not opened].

**With integration**

- The real conflict. backend's role.md says it builds "integrations with outside services"; `roles/integration/role.md` says integration "integrates external services behind an interface" and owns `external-api` and `resilient-integration`. A backend Agent calling a mail or payment provider today has neither skill. ADR-0005 says a skill used by several Roles lives in `library/` (question 3).

**With performance**

- S6 and `query-cost-in-a-diff` are the same topic from two sides. Keep the reviewer's skill as it is and make S6 short, or skip S6.

**With fullstack**

- Finding C: fullstack reads backend's "What this Role knows" by section name. Whatever moves to `rules.md` must stay reachable for fullstack.

---

## 7. Open decisions for the owner

1. **What does a checkable rule look like, and who checks it?**
   - (a) `rules.md` rows with an id, the rule, and the check (reviewer, script, CLI); the review brief for a backend task points at the file.
   - (b) Same format, but self-check only: the Agent runs the scripts and states the result in its reply.
   - (c) Keep the existing 3-bullet style.
   - Recommend (a): without the reviewer reading it, "checkable" has no checker. It needs a small change in how the review brief is built.

2. **Does "What this Role knows" move into `rules.md`?**
   - (a) Move the must-items to `rules.md`, leave role.md with Responsibility, Boundaries, Procedure, Done when (the shape `database` and `integration` use), and repoint `fullstack` at `roles/backend/rules.md`.
   - (b) Keep both and accept the duplication.
   - Recommend (a).

3. **Who builds the adapter to an outside service inside a backend task?**
   - (a) backend builds it; move `external-api` and `resilient-integration` to `library/skills/` and list them for both Roles.
   - (b) integration always builds it; remove "integrations with outside services" from backend's Responsibility.
   - (c) Leave as is.
   - Recommend (a): a Slice that is not split has no integration task, so the knowledge must reach backend.

4. **Role scripts: runtime and status.**
   - (a) Node `.mjs`, no dependencies, called by path through `aidw plugin-path`, tested under `tests/`, advisory only.
   - (b) Add an `aidw role-script <role> <name>` command.
   - (c) No scripts in version 1; state the measurements as test patterns in the skills.
   - Recommend (a) with the three starred scripts.

5. **How do backend's own skills get loaded?**
   - (a) `skills:` in role.md with a load condition, and the Agent decides (as `database` and `integration` do).
   - (b) Deterministic, in `src/skills.ts`, by signal in the task.
   - Recommend (a) for consistency, and accept that loading is then a judgment the evals must test.

6. **Logging and errors: a skill of its own?**
   - (a) Author the small S5.
   - (b) Rely on vendored `addy/observability-and-instrumentation` and keep only rule B14.
   - Recommend (b) for version 1; revisit if evals show leaks in logs.

7. **Which skills ship first?** The bar is two.
   - Recommend S1 `endpoint-test-matrix`, S2 `transactions-and-races`, S3 `repeat-safe-writes`; S4 after question 3; S6 folded into S1.

8. **Fix findings A and B now or separately?**
   - Recommend separately and first, as a `fix` commit: they are CLI bugs, not Role content, and A changes what backend inherits.

9. **How strict is B2 (three access tests per route with a record id)?**
   - (a) A rule, always.
   - (b) Only when the scenario mentions ownership.
   - Recommend (a): broken object-level authorization is the first item of the OWASP API list and both existing evals already turn on it.

10. **Scope of stacks for the scripts in version 1.**
    - (a) Node and Python frameworks that have a pack (NestJS, Next.js route handlers, FastAPI, Django).
    - (b) Node only.
    - Recommend (a) for `env-names` and `error-shape-probe`, which are nearly stack-agnostic, and (b) for `route-inventory` at first.

11. **Are answer-only evals enough for this Role?**
    - The four new cases are written to be judged from text. Whether the Agent really writes the two-request test can only be seen in a run with tools. This is a question about `aidw eval` as a whole, not only backend.

---

## Sources opened in this session

| Source | URL | Licence | What to take |
|---|---|---|---|
| OWASP API Security Top 10 2023 | https://api-security.owasp.org/editions/2023/en/0x11-t10 | page shows copyright only; CC BY-SA 4.0 [M] | API1, API3, API4, API5, API10 as rule sources |
| RFC 9457 | https://www.rfc-editor.org/rfc/rfc9457.html | IETF Trust | members, `application/problem+json`, no implementation details in errors |
| IETF Idempotency-Key draft 09 | https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/ | IETF Trust | fingerprint, `422`, `409`, `400`, expiry policy |
| Stripe idempotent requests | https://docs.stripe.com/api/idempotent_requests | proprietary | store first response, compare parameters, 24-hour pruning |
| Transactional outbox | https://microservices.io/patterns/data/transactional-outbox.html | All rights reserved | outbox in the same transaction, at-least-once, idempotent consumer |
| OpenTelemetry HTTP spans | https://opentelemetry.io/docs/specs/semconv/http/http-spans/ | not shown; CC BY 4.0 [M] | route template as name, `4xx` vs `5xx` status, headers opt-in |
| OpenTelemetry logs data model | https://opentelemetry.io/docs/specs/otel/logs/data-model/ | not shown | TraceId and SpanId on log records |
| Google AIP-193 | https://google.aip.dev/193 | CC BY 4.0, samples Apache-2.0 | stable machine-readable reason, message for people, no internals |
| OWASP Logging Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html | CC BY-SA 4.0 | what to log, what never to log |
| Twelve-Factor App | https://12factor.net/ and https://github.com/twelve-factor/twelve-factor | site: All rights reserved; repo: CC BY 4.0 | III Config, XI Logs, IX Disposability |
| strong_migrations | https://github.com/ankane/strong_migrations | MIT | lock timeout, backfill outside the schema transaction |
| VoltAgent backend-developer | https://github.com/VoltAgent/awesome-claude-code-subagents (categories/01-core-development/backend-developer.md) | MIT | checklist headings; numeric targets rejected |
| wshobson/agents backend-development | https://github.com/wshobson/agents/tree/main/plugins/backend-development | MIT | list of implementer-level resilience concerns |
| obra/superpowers | https://github.com/obra/superpowers/tree/main/skills | MIT | "watch it fail for the right reason" |
| getsentry/skills | https://github.com/getsentry/skills | Apache-2.0 | `secret-serialization` as a candidate to read |
| github/spec-kit, BMAD-METHOD, OpenSpec, anthropics/skills | github.com front pages only | MIT, MIT, MIT, mixed | nothing backend-specific found at that depth |

Not opened, cited from memory: PostgreSQL documentation on isolation and locking, AWS Builders' Library, Prisma and Django N+1 documentation, Zalando and Microsoft API guidelines (already named as sources in `api-design-rules`).
