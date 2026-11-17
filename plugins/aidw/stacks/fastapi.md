---
framework: FastAPI
roles: [backend, fullstack]
skills: [fastapi/fastapi]
---
# Framework pack: FastAPI

How to build an HTTP API with FastAPI. Tooling (package manager, formatter, tests, CI) is in `python.md`; this file is only
what is specific to the framework. A framework pack answers the same questions under the same headings (a test checks it,
ADR-0001). An existing FastAPI project keeps its own structure and `.aidw/constitution.md` first.

## Structure

- `app/main.py` creates the `FastAPI()` app, includes the routers and registers exception handlers; nothing else lives there.
- One **router** per capability (`app/bookings/router.py`) with its `schemas.py` (Pydantic models), `service.py` (the business
  rule, the unit tests target it), `models.py` (SQLAlchemy/SQLModel) and `dependencies.py`.
- `app/core/config.py` holds the settings (`pydantic-settings`); `app/db.py` the engine and the session dependency.

## Conventions

- **Schemas are the contract.** Request bodies and responses are Pydantic models; set `response_model` on every route so a
  field the contract does not list is dropped (never return an ORM object without one). Separate `Create`, `Update` and `Read`
  schemas; the read schema omits internal columns.
- Dependencies (`Depends`) provide the database session, the current user and settings; override them in tests with
  `app.dependency_overrides`.
- Authorization is a dependency applied to the router (`dependencies=[Depends(require_user)]`); check ownership of the record in
  the service, not only the role in the dependency.
- Failures are `HTTPException(status_code, detail)` or a custom exception with a registered handler that shapes the error body
  the API contract names. Never return `200` with an error inside.
- `async def` only when every call inside is non-blocking. A blocking call (a sync database driver, `requests`, file I/O) in an
  `async def` route stalls the whole event loop: use a plain `def` route (it runs in a thread pool) or an async client.

## Data and mutations

- One session per request through a dependency, committed or rolled back in one place. A write that touches several rows runs in
  one transaction.
- A migration is its own task (Alembic: `alembic revision --autogenerate`, then read it): reversible (`downgrade` implemented),
  tested against a seeded database. A schema change without a migration fails the `code` layer (`alembic check`).
- Pagination, sorting and filters are query parameters with defaults and a maximum page size.

## Environment variables

- Declare each one as a field of a `pydantic-settings` `Settings` class, loaded once (`@lru_cache` on `get_settings`); a missing
  required variable fails at start-up. `.env` is never committed; list every variable in `.env.example`.

## Testing

- `pytest` with `httpx.AsyncClient(transport=ASGITransport(app=app))` (or `TestClient`) through the real routes; override the
  database and external-service dependencies at the boundary. Use a SQLite or throwaway test database, rolled back per test.
- Test each endpoint's authorization: anonymous, another user's record, the owner; and the validation error shape (`422`).
- Playwright starts `uvicorn app.main:app` through its `webServer` and tests the scenarios; the test name carries the scenario id.

## Common mistakes

- A blocking call inside `async def`; a sync SQLAlchemy session shared across threads.
- Returning the ORM object or a dict without `response_model`, leaking columns such as password hashes.
- Mutable default arguments or module-level state shared between requests; a global database session.
- Catching `Exception` in a route and returning `200`; swallowing `HTTPException`.
- `CORSMiddleware` with `allow_origins=["*"]` together with `allow_credentials=True`.
- Reading `os.environ` inside routes instead of the settings object.

## Commands

`uv run fastapi dev` or `uv run uvicorn app.main:app --reload` (local), `uv run pytest` (unit), `uv run ruff check .`,
`uv run mypy .`, `uv run alembic upgrade head` (apply migrations to a local database only). `.venv/` and `__pycache__/` are
generated and never committed.
