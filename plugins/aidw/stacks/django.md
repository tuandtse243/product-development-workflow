---
framework: Django
roles: [backend, fullstack]
review_skills: [sentry/django-perf-review]
---
# Framework pack: Django

How to build a web app or an API with Django. Tooling (package manager, formatter, tests, CI) is in `python.md`; this file is
only what is specific to the framework. A framework pack answers the same questions under the same headings (a test checks it,
ADR-0001). An existing Django project keeps its own structure and `.aidw/constitution.md` first.

## Structure

- One **app** per capability (`python manage.py startapp bookings`) with its `models.py`, `views.py`, `urls.py`, `forms.py` or
  `serializers.py`, `admin.py` and `tests/` beside it. Register it in `INSTALLED_APPS`.
- `config/` (or the project package) holds `settings.py` (split into `base`, `dev`, `prod` when it grows), the root `urls.py`,
  `asgi.py` and `wsgi.py`. Business rules that outgrow a view go in a `services.py` of the app, which tests target.
- An API uses Django REST Framework (`serializers.py`, `viewsets`) or django-ninja; follow what the project already has.

## Conventions

- Fat models are fine for data rules, but a rule across several models belongs in a service function, not in a view or a signal.
  Avoid signals for business logic: they hide the flow.
- Validate every input with a `Form`/`ModelForm` or a serializer; never read `request.POST` or `request.data` raw into a model.
- Authorization is explicit on every view: `LoginRequiredMixin`, `permission_classes`, or a queryset filtered to the caller's
  own records (`get_queryset` filters by `request.user`). A view that looks up a record by id must check ownership.
- Failures are the framework's: `Http404`, `PermissionDenied`, `ValidationError`, or DRF exceptions; the API contract names the
  error body. Never return `200` with an error inside.
- Settings from the environment (`django-environ` or `os.environ` read once in `settings.py`); `DEBUG = False` and a set
  `ALLOWED_HOSTS` outside local development; `SECRET_KEY` never in the repository.

## Data and mutations

- The ORM is the only code that talks to the database. Avoid N+1 queries: `select_related` for foreign keys, `prefetch_related`
  for many-to-many and reverse relations; assert the query count in a test for a list view (`assertNumQueries`).
- A write that touches several rows runs in `transaction.atomic()`. Use `F()` expressions and `select_for_update()` for counters
  and for anything two requests can race on.
- Every model change has a migration (`makemigrations`, committed). A migration is its own task: reversible (a `RunPython` has a
  reverse function), tested against a seeded database; adding a non-null column to a table with rows is expand-contract.
- Return the fields the contract names, not whole model dumps: no password hashes, no internal ids.

## Environment variables

- Read each one once in settings, with a default only when it is safe (`DEBUG`, `LOG_LEVEL`). A missing required variable fails at
  start-up with a clear message. `.env` is never committed; list every variable in `.env.example`.

## Testing

- `pytest-django` (`DJANGO_SETTINGS_MODULE` in `pyproject.toml`), with `@pytest.mark.django_db` for tests that touch the database
  and factories (`factory_boy`) instead of fixtures files. Test a view with the test `client` (or DRF's `APIClient`), a service
  as a plain function.
- Test the permission of every endpoint: anonymous, another user's record, and the owner.
- Playwright starts `python manage.py runserver` (or the built container) through its `webServer` and tests the scenarios; the
  test name carries the scenario id.

## Common mistakes

- `DEBUG = True` or a hard-coded `SECRET_KEY` in the committed settings; an empty `ALLOWED_HOSTS` that "works" locally.
- A queryset not filtered to the caller (any user can read any id); a `ModelSerializer` with `fields = "__all__"` that exposes
  new columns by accident.
- N+1 queries in a list view or a serializer method field; `.count()` on a big queryset in a loop.
- Raw SQL built with string formatting instead of parameters; `mark_safe` on user input; `csrf_exempt` "to make the form work".
- Business logic in a signal or a migration; editing an applied migration instead of adding a new one.
- Calling `datetime.now()` in a model default instead of `django.utils.timezone.now` (naive dates with `USE_TZ = True`).

## Commands

`uv run python manage.py runserver` (local), `uv run python manage.py check` and `makemigrations --check --dry-run` (the `code`
layer catches a missing migration), `uv run pytest` (unit), `uv run ruff check .`, `uv run mypy .`. `collectstatic` output
(`staticfiles/`) and `db.sqlite3` are generated and never committed.
