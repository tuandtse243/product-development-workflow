# Stack pack: Python

Applies to Django, FastAPI and Flask projects, and to plain Python services. Every stack pack answers the same questions under
the same headings (a test checks it), so adding a language means adding one file like this one (ADR-0001). The
language-neutral rules are in `library/code-style.md`. An existing project keeps its tool (uv, Poetry, Pipenv or pip) and its
`.aidw/constitution.md` first; the choices below are for a new project.

## Package manager and install

uv. `uv sync` for a fresh install, `uv sync --frozen` in CI (the lockfile `uv.lock` is committed). Run every tool through
`uv run <tool>` so it uses the project's environment. Poetry projects use `poetry install` and `poetry run`; pip projects use
a virtual environment (`python -m venv .venv`) and `python -m <tool>`. The environment lives in `.venv/` and is never committed.

Install safety, in `pyproject.toml`: `[tool.uv]` `exclude-newer = "3 days"` (uv 0.9.17 and later accept a duration), the
same limit the aidw checkpoint applies to an added package. A package that must be newer is named in
`exclude-newer-package`, with the reason in a comment.

## Formatter

ruff format (it replaces black), configured in `pyproject.toml` under `[tool.ruff]` with `line-length = 100`. Run
`uv run ruff format .` once at the end of the scaffold task so the first commit is clean.

## Linter

ruff check, configured in `pyproject.toml`. A new project selects more than the defaults:

```toml
[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "SIM", "C4", "RET", "PT", "S", "ASYNC", "DTZ", "T20", "PERF", "TID", "C90", "RUF"]

[tool.ruff.lint.mccabe]
max-complexity = 12

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["S101"] # assert is how pytest asserts
```

(bugbear, pyupgrade, simplify, comprehensions, return, pytest style, bandit, async, timezone-aware datetimes, no stray
`print`, performance, tidy imports, complexity, Ruff's own rules.) The framework pack adds its set (`DJ` for Django,
`FAST` for FastAPI). `uv run ruff check .` is part of the `code` layer. A rule is switched off for a path in
`per-file-ignores` with the reason in a comment, not with a bare `# noqa`.

Two more checks run in the `code` layer of a new project:

- **deptry** (`uv run deptry .`): a dependency that is imported but not declared, declared but unused, or only there
  through another package. Exceptions go in `[tool.deptry.per_rule_ignores]`.
- **import-linter** (`uv run lint-imports`, contracts in `[tool.importlinter]`): one `layers` contract for the layering
  the architecture names (for example `layers = ["api", "services", "repositories"]` with `containers = ["<package>"]`),
  and a `forbidden` contract per boundary that must not be crossed.

## Typecheck

Pyright in strict mode for a new project: `[tool.pyright]` `typeCheckingMode = "strict"`, run with `uv run pyright`
(dev dependency `pyright[nodejs]`: the PyPI package is a community wrapper that downloads Pyright and the Node it needs).
A project that already uses mypy keeps it (`uv run mypy .`, `strict = true` in `[tool.mypy]`). Either way it is part of
the `code` layer. A project with no type hints yet starts looser (`typeCheckingMode = "standard"`, or mypy with
`check_untyped_defs = true`) and tightens later. Astral's `ty` is still beta: do not make it the gate yet.

## Test runner and JUnit output

pytest with `tests/` mirroring the package, `tests/unit` and `tests/integration` markers or folders for the two layers.
JUnit: `uv run pytest --junitxml=test-results/unit.xml`. Playwright (`pytest-playwright`) for `e2e`, `a11y` and `shots`.
Coverage: `--cov=<package> --cov-report=lcov:coverage/lcov.info`, so the `unit` layer can check the lines the Change
added (`roles/qa/references/quality-layers.md`, "Coverage on the diff"). A layer that declares `reports:` and writes none fails verify. Tests never reach the network or a real database server:
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
