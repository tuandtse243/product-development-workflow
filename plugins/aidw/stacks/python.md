# Stack pack: Python

Applies to Django, FastAPI and Flask projects, and to plain Python services. Every stack pack answers the same questions under
the same headings (a test checks it), so adding a language means adding one file like this one (ADR-0001). The
language-neutral rules are in `library/code-style.md`. An existing project keeps its tool (uv, Poetry, Pipenv or pip) and its
`.aidw/constitution.md` first; the choices below are for a new project.

## Package manager and install

uv. `uv sync` for a fresh install, `uv sync --frozen` in CI (the lockfile `uv.lock` is committed). Run every tool through
`uv run <tool>` so it uses the project's environment. Poetry projects use `poetry install` and `poetry run`; pip projects use
a virtual environment (`python -m venv .venv`) and `python -m <tool>`. The environment lives in `.venv/` and is never committed.

## Formatter

ruff format (it replaces black), configured in `pyproject.toml` under `[tool.ruff]` with `line-length = 100`. Run
`uv run ruff format .` once at the end of the scaffold task so the first commit is clean.

## Linter

ruff check, with `select = ["E", "F", "I", "B", "UP"]` as a base (pycodestyle, pyflakes, import order, bugbear, pyupgrade);
the framework pack may add rules (`DJ` for Django). `uv run ruff check .` is part of the `code` layer.

## Typecheck

mypy (`uv run mypy .`, strict on new code: `strict = true` in `[tool.mypy]`) or Pyright when the project already uses it. It
is part of the `code` layer. A project with no type hints yet starts with `check_untyped_defs = true` and tightens later.

## Test runner and JUnit output

pytest with `tests/` mirroring the package, `tests/unit` and `tests/integration` markers or folders for the two layers.
JUnit: `uv run pytest --junitxml=test-results/unit.xml`. Playwright (`pytest-playwright`) for `e2e`, `a11y` and `shots`.
A layer that declares `reports:` and writes none fails verify. Tests never reach the network or a real database server:
use SQLite or a throwaway container, and a fake at each external boundary.

## Pre-commit hook

pre-commit (`.pre-commit-config.yaml`) with `ruff` (lint, with `--fix`) and `ruff-format` hooks. Install it with
`uv run pre-commit install`. The hook does not run mypy or the tests: the quality layers own those.

## Commit messages

Conventional Commits, header up to 72 characters. Enforce it with the `commitizen` or `conventional-pre-commit` hook at the
`commit-msg` stage. Subject case and body line length are not enforced: aidw footers carry long evidence paths.

## Paths never committed

`.venv/`, `venv/`, `__pycache__/`, `*.pyc`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`, `.tox/`, `coverage/`, `htmlcov/`,
`test-results/`, `*.egg-info/`, `dist/`, `.env*` (except `.env.example`). `src/git.ts` refuses to commit the generated ones.

## .gitignore template

```
.venv/
venv/
__pycache__/
*.pyc
.pytest_cache/
.mypy_cache/
.ruff_cache/
.tox/
htmlcov/
coverage/
test-results/
*.egg-info/
dist/
.env*
!.env.example
```

## CI

`roles/devops/references/ci.md` has the GitHub Actions workflow for Node; for Python the same shape applies: set up Python
with `actions/setup-python@v5` (or `astral-sh/setup-uv@v5`), `uv sync --frozen`, then one step per command of the `code`,
`unit` and `integration` layers (`uv run ruff check .`, `uv run mypy .`, `uv run pytest`), in the order `quality.yaml` lists them.
