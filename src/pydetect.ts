import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Python half of `aidw detect`: reads the dependency names of a Python project from `pyproject.toml` (PEP 621, Poetry,
 * dependency groups) and `requirements*.txt` without a TOML library, and names the tool that runs it. Tolerant on purpose:
 * detection only proposes, the Analysis decides.
 */
export type PythonTool = "uv" | "poetry" | "pipenv" | "pip";

export interface PythonProject {
  /** lower-case names, `_` and `.` normalised to `-`, mapped to the first version found ("" when unpinned) */
  deps: Record<string, string>;
  tool: PythonTool;
  /** tools configured by a file or a pyproject table even when not listed as a dependency */
  configured: { ruff: boolean; pytest: boolean; mypy: boolean };
}

const norm = (name: string): string => name.toLowerCase().replace(/[_.]+/g, "-");
const REQ = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(?:(?:==|>=|~=|<=|>|<|!=|===)\s*([0-9][0-9A-Za-z.*+!-]*))?/;

/** A requirement string (`fastapi[standard]>=0.115`) as name and first version, or null for anything else. */
function parseRequirement(s: string): [string, string] | null {
  const m = REQ.exec(s.trim());
  if (!m) return null;
  const rest = s.trim().slice(m[0].length).trim();
  if (rest && !/^[;,<>=!~]/.test(rest) && !rest.startsWith("@")) return null; // prose, not a requirement
  return [norm(m[1] as string), m[2] ?? ""];
}

const SECTION_ARRAYS = /^(project|project\.optional-dependencies|dependency-groups|tool\.uv|tool\.pdm\.dev-dependencies)$/;
const POETRY_SECTION = /^tool\.poetry(\.group\.[^.]+)?\.(dev-)?dependencies$/;

function fromPyproject(text: string, out: Record<string, string>): void {
  let section = "";
  let inArray = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const head = /^\[+\s*([^\]]+?)\s*\]+\s*(#.*)?$/.exec(line);
    if (!inArray && head) {
      section = head[1] as string;
      continue;
    }
    if (POETRY_SECTION.test(section)) {
      const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*(.*)$/.exec(line);
      if (m && norm(m[1] as string) !== "python") {
        const v = /["']\^?~?[>=<]*\s*([0-9][0-9A-Za-z.*+-]*)/.exec(m[2] as string);
        out[norm(m[1] as string)] ??= v?.[1] ?? "";
      }
      continue;
    }
    if (!SECTION_ARRAYS.test(section)) continue;
    const key = /^([\w.-]+)\s*=\s*\[/.exec(line)?.[1];
    // only dependency arrays: [project] also holds keywords, classifiers and authors
    if (!inArray && key && (section === "project" ? key === "dependencies" : section === "tool.uv" ? key === "dev-dependencies" : true)) inArray = true;
    if (!inArray) continue;
    for (const s of line.matchAll(/"([^"]+)"|'([^']+)'/g)) {
      const r = parseRequirement((s[1] ?? s[2]) as string);
      if (r) out[r[0]] ??= r[1];
    }
    if (line.replace(/"[^"]*"|'[^']*'/g, "").includes("]")) inArray = false;
  }
}

function fromRequirements(text: string, out: Record<string, string>): void {
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#") || line.startsWith("-") || /^(https?|git\+)/.test(line)) continue;
    const r = parseRequirement(line);
    if (r) out[r[0]] ??= r[1];
  }
}

function read(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** The Python project at `dir`, or null when it has none of the Python project files. */
export function detectPython(dir: string): PythonProject | null {
  const pyproject = existsSync(join(dir, "pyproject.toml")) ? read(join(dir, "pyproject.toml")) : null;
  const reqFiles = readdirSync(dir).filter((f) => /^requirements([-_.][\w.-]+)?\.txt$/.test(f));
  const hasPipfile = existsSync(join(dir, "Pipfile"));
  if (pyproject === null && !reqFiles.length && !hasPipfile) return null;

  const deps: Record<string, string> = {};
  if (pyproject) fromPyproject(pyproject, deps);
  for (const f of reqFiles) fromRequirements(read(join(dir, f)), deps);
  if (hasPipfile) {
    let sec = "";
    for (const line of read(join(dir, "Pipfile")).split("\n")) {
      const h = /^\[([\w-]+)\]/.exec(line.trim());
      if (h) sec = h[1] as string;
      else if (sec === "packages" || sec === "dev-packages") {
        const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*(.*)$/.exec(line.trim());
        if (m) deps[norm(m[1] as string)] ??= /([0-9][0-9A-Za-z.*-]*)/.exec(m[2] as string)?.[1] ?? "";
      }
    }
  }

  const tool: PythonTool = existsSync(join(dir, "uv.lock")) || /^\[tool\.uv[\].]/m.test(pyproject ?? "")
    ? "uv"
    : existsSync(join(dir, "poetry.lock")) || /^\[tool\.poetry[\].]/m.test(pyproject ?? "")
      ? "poetry"
      : hasPipfile
        ? "pipenv"
        : "pip";
  const has = (re: RegExp) => re.test(pyproject ?? "");
  return {
    deps,
    tool,
    configured: {
      ruff: existsSync(join(dir, "ruff.toml")) || existsSync(join(dir, ".ruff.toml")) || has(/^\[tool\.ruff[\].]/m),
      pytest: existsSync(join(dir, "pytest.ini")) || has(/^\[tool\.pytest/m) || existsSync(join(dir, "tests")),
      mypy: existsSync(join(dir, "mypy.ini")) || has(/^\[tool\.mypy[\].]/m),
    },
  };
}

/** The prefix that runs an installed tool in the project's environment. */
export function pyRun(tool: PythonTool): string {
  return tool === "uv" ? "uv run" : tool === "poetry" ? "poetry run" : tool === "pipenv" ? "pipenv run" : "python -m";
}
