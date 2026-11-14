import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { detectProject } from "../src/detect.js";
import { detectPython } from "../src/pydetect.js";
import { packsFor } from "../src/stackpacks.js";

const plugin = join(__dirname, "..", "plugins", "aidw");
const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "aidw-py-"));
  temps.push(dir);
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

const PYPROJECT = `[project]
name = "bookings"
version = "0.1.0"
description = "A web api"
keywords = ["web", "api"]
requires-python = ">=3.12"
dependencies = [
  "fastapi[standard]>=0.115.0",
  "sqlalchemy==2.0.36",
  "psycopg[binary]>=3.2",  # driver
  "uvicorn",
]

[project.optional-dependencies]
dev = ["pytest>=8", "ruff"]

[dependency-groups]
types = [
  "mypy>=1.13",
]

[tool.ruff]
line-length = 100
`;

describe("Python detection", () => {
  it("is null for a directory with no Python project file", () => {
    expect(detectPython(project({ "README.md": "x" }))).toBeNull();
  });

  it("reads dependency names and versions from pyproject.toml, and ignores keywords and classifiers", () => {
    const py = detectPython(project({ "pyproject.toml": PYPROJECT }))!;
    expect(py.deps).toMatchObject({ fastapi: "0.115.0", sqlalchemy: "2.0.36", uvicorn: "", pytest: "8", ruff: "", mypy: "1.13" });
    expect(py.deps).not.toHaveProperty("web");
    expect(py.deps).not.toHaveProperty("api");
    expect(py.configured.ruff).toBe(true);
  });

  it("reads Poetry tables, requirements files and a Pipfile", () => {
    const poetry = detectPython(project({ "pyproject.toml": '[tool.poetry.dependencies]\npython = "^3.12"\nDjango = "^5.1"\n\n[tool.poetry.group.dev.dependencies]\npytest = "^8.0"\n' }))!;
    expect(poetry.tool).toBe("poetry");
    expect(poetry.deps).toMatchObject({ django: "5.1", pytest: "8.0" });
    expect(poetry.deps).not.toHaveProperty("python");

    const req = detectPython(project({ "requirements.txt": "# deps\n-r base.txt\nFlask==3.0.3  # web\nrequests[socks]>=2\ngit+https://x/y.git\n", "requirements-dev.txt": "pytest\n" }))!;
    expect(req.tool).toBe("pip");
    expect(req.deps).toMatchObject({ flask: "3.0.3", requests: "2", pytest: "" });

    const pipenv = detectPython(project({ Pipfile: '[packages]\ndjango = "==5.0"\n[dev-packages]\npytest = "*"\n' }))!;
    expect(pipenv.tool).toBe("pipenv");
    expect(pipenv.deps).toHaveProperty("django", "5.0");
  });

  it("names uv from its lockfile", () => {
    expect(detectPython(project({ "pyproject.toml": PYPROJECT, "uv.lock": "" }))!.tool).toBe("uv");
  });
});

describe("a Python project in aidw detect", () => {
  const dir = project({ "pyproject.toml": PYPROJECT, "uv.lock": "", "app/main.py": "x = 1\n", "tests/test_x.py": "def test_x(): pass\n" });
  const d = detectProject(dir);

  it("is a brownfield project with a Python stack and the stack pack", () => {
    expect(d.kind).toBe("brownfield");
    expect(d.languages).toContain("Python");
    expect(d.pythonTool).toBe("uv");
    expect(d.packageManager).toBeNull();
    expect(d.stackPack).toBe("python");
    expect(d.stack).toMatchObject({ framework: "FastAPI 0.115.0", orm: "SQLAlchemy 2.0.36", database: "PostgreSQL", "unit tests": "pytest 8", linter: "Ruff", types: "mypy 1.13" });
  });

  it("proposes the code and unit layers from the project's own tools, run through the tool", () => {
    expect(d.layers).toEqual([
      { name: "code", run: ["uv run ruff check .", "uv run mypy ."] },
      { name: "unit", run: ["uv run pytest"] },
    ]);
  });

  it("runs a pip project's tools as `python -m`", () => {
    const pip = detectProject(project({ "requirements.txt": "flask\npytest\nruff\n", "app.py": "x = 1\n" }));
    expect(pip.layers.map((l) => l.run)).toEqual([["python -m ruff check ."], ["python -m pytest"]]);
  });

  it("warns that a Python project has no .gitignore", () => {
    expect(d.warnings.join("\n")).toMatch(/no \.gitignore.*\.venv\//);
  });

  it("gives the Django and FastAPI packs to the backend, and no pack for Flask", () => {
    expect(packsFor(plugin, d.stack, "backend").map((p) => p.id)).toEqual(["fastapi"]);
    expect(packsFor(plugin, { framework: "Django 5.1" }, "fullstack").map((p) => p.id)).toEqual(["django"]);
    expect(packsFor(plugin, { framework: "Django 5.1" }, "frontend")).toEqual([]);
    expect(packsFor(plugin, { framework: "Flask 3.0" }, "backend")).toEqual([]);
  });

  it("merges with a Node project: both test suites run in the same layers", () => {
    const both = detectProject(project({ "package.json": JSON.stringify({ scripts: { test: "vitest run", lint: "eslint ." } }), "requirements.txt": "django\npytest\n", "a.py": "x=1\n" }));
    const unit = both.layers.find((l) => l.name === "unit")!;
    expect(unit.run).toEqual(["npm test", "python -m pytest"]);
    expect(both.stackPack).toBe("node");
  });
});
