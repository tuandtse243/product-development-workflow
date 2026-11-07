import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeChange, idsAfterChange, mainSpecIds } from "./analyze.js";
import { approvalStatus, computeApprovalHash } from "./approval.js";
import { runBackstop } from "./backstop.js";
import { ChangeError, isState, listChangeIds, loadChange, NEEDS_ANALYSIS, resolveChangeId, STATES } from "./change.js";
import { runGate } from "./gate.js";
import { checkChange, checkSpecs } from "./check.js";
import { Diags, type Diagnostic } from "./diag.js";
import {
  approve,
  archiveChange,
  assertProject,
  initProject,
  INPUT_TYPES,
  newChange,
  OpError,
  planMerge,
  projectStatus,
  transition,
  writeMerge,
} from "./ops.js";
import { findProject, pathsFor, rel, type Paths } from "./project.js";
import { VERSION } from "./version.js";

const HELP = `aidw ${VERSION} - deterministic core of the AI Fullstack Autonomous Development Workflow

Usage: aidw <command> [args] [--json] [--root <dir>]

  init                                   create .aidw/ in the current directory (or --root)
  change new <id> [--title T] [--input-type ${INPUT_TYPES.join("|")}]
  status [<id>]                          project and change status
  validate [<id>] [--strict]             validate specs and changes (all when no id)
  approve <id>                           approve the Analysis package (hashes it)
  approval check <id>                    exit 1 when the approved package drifted
  transition <id> <state|resume> [--reason R]
  merge <id> [--write]                   merge delta specs into .aidw/specs (dry run by default)
  archive <id>                           merge deltas and move a delivered change to archive/
  analyze [<id>]                         pre-gate consistency checks (analysis.md, task coverage)
  ids [<id>]                             requirement and scenario ids (after applying the change)
  vendor-path <upstream>/<skill>         absolute path of a vendored SKILL.md (e.g. pocock/grilling)
  plugin-path <path>                     absolute path of a plugin file (e.g. profiles/stack-pool.md)
  gate                                   PreToolUse hook: reads hook JSON on stdin
  backstop                               Stop hook: reads hook JSON on stdin
  version

States: ${STATES.join(", ")}
Exit codes: 0 ok, 1 failed check or refused operation, 2 usage error
`;

interface Args {
  pos: string[];
  flags: Record<string, string | true>;
}

const VALUE_FLAGS = new Set(["root", "title", "input-type", "reason"]);

export function parseArgs(argv: string[]): Args {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (eq > 0) flags[name] = a.slice(eq + 1);
    else if (VALUE_FLAGS.has(name)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`--${name} needs a value`);
      flags[name] = v;
      i++;
    } else flags[name] = true;
  }
  return { pos, flags };
}

class UsageError extends Error {}

interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
  stdin?: () => string;
}

/** Root of the installed plugin (bin/ lives in it). */
export function pluginRoot(env: NodeJS.ProcessEnv): string {
  if (env.AIDW_PLUGIN_ROOT) return env.AIDW_PLUGIN_ROOT;
  if (typeof __dirname !== "undefined") return join(__dirname, "..");
  if (env.CLAUDE_PLUGIN_ROOT) return env.CLAUDE_PLUGIN_ROOT;
  return join(process.cwd(), "plugins", "aidw");
}

function fmtDiag(d: Diagnostic): string {
  const where = d.line ? `${d.file}:${d.line}` : d.file;
  return `${d.level === "error" ? "ERROR" : "WARN "}  ${where}  ${d.message}`;
}

function str(v: string | true | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function run(argv: string[], env: NodeJS.ProcessEnv, cwd: string, io: Io): number {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    io.err(`aidw: ${(e as Error).message}\n`);
    return 2;
  }
  const json = args.flags.json === true;
  const [cmd, ...rest] = args.pos;
  const emit = (data: unknown, text: string) => io.out(json ? `${JSON.stringify(data, null, 2)}\n` : text);
  const diagsJson = (d: Diags) => ({ errors: d.errors, warnings: d.warnings });
  const printDiags = (d: Diags) => d.items.map(fmtDiag).join("\n") + (d.items.length ? "\n" : "");

  const project = (): Paths => {
    const dir = findProject({ root: str(args.flags.root), cwd, env });
    if (!dir) throw new OpError("no .aidw/ found in this directory or its parents; run `aidw init`");
    const p = pathsFor(dir);
    assertProject(p);
    return p;
  };
  const need = (v: string | undefined, what: string): string => {
    if (!v) throw new UsageError(`missing ${what}`);
    return v;
  };

  try {
    switch (cmd) {
      case undefined:
      case "help":
      case "--help":
        io.out(HELP);
        return args.pos.length === 0 && !args.flags.help ? 2 : 0;

      case "version":
        emit({ version: VERSION }, `${VERSION}\n`);
        return 0;

      case "gate": {
        io.out(runGate(io.stdin?.() ?? "", env));
        return 0;
      }

      case "backstop": {
        io.out(runBackstop(io.stdin?.() ?? "", env));
        return 0;
      }

      case "vendor-path": {
        const ref = need(rest[0], "<upstream>/<skill>");
        if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(ref)) throw new UsageError(`invalid vendored skill "${ref}"`);
        const file = join(pluginRoot(env), "vendor", ...ref.split("/"), "SKILL.md");
        if (!existsSync(file)) throw new OpError(`vendored skill "${ref}" not found at ${file}`);
        emit({ path: file }, `${file}\n`);
        return 0;
      }

      case "plugin-path": {
        const ref = need(rest[0], "relative path inside the plugin");
        if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(ref) || ref.split("/").includes("..")) {
          throw new UsageError(`invalid plugin path "${ref}"`);
        }
        const file = join(pluginRoot(env), ...ref.split("/"));
        if (!existsSync(file)) throw new OpError(`"${ref}" not found in the plugin (${file})`);
        emit({ path: file }, `${file}\n`);
        return 0;
      }

      case "analyze": {
        const p = project();
        const id = resolveChangeId(p, rest[0]);
        const d = analyzeChange(p, id);
        const summary = `${d.errors.length ? "FAILED" : "OK"}: ${d.errors.length} error(s), ${d.warnings.length} warning(s)\n`;
        emit({ ok: d.errors.length === 0, id, ...diagsJson(d) }, printDiags(d) + summary);
        return d.errors.length ? 1 : 0;
      }

      case "ids": {
        const p = project();
        const id = rest[0] ?? (listChangeIds(p).length === 1 ? listChangeIds(p)[0] : undefined);
        let requirements: string[];
        let scenarios: string[];
        let changed: { requirements: string[]; scenarios: string[] } | undefined;
        if (id) {
          const r = idsAfterChange(p, id);
          requirements = [...r.ids.requirements].sort();
          scenarios = [...r.ids.scenarios].sort();
          changed = { requirements: [...r.changed.requirements].sort(), scenarios: [...r.changed.scenarios].sort() };
        } else {
          const all = mainSpecIds(p);
          requirements = [...all.requirements].sort();
          scenarios = [...all.scenarios].sort();
        }
        const mark = (x: string, set?: string[]) => (set?.includes(x) ? "* " : "  ");
        const text = [
          `requirements${id ? ` (after ${id}; * = changed)` : ""}`,
          ...requirements.map((r) => `${mark(r, changed?.requirements)}${r}`),
          "scenarios",
          ...scenarios.map((s) => `${mark(s, changed?.scenarios)}${s}`),
        ].join("\n");
        emit({ change: id ?? null, requirements, scenarios, changed: changed ?? null }, `${text}\n`);
        return 0;
      }

      case "init": {
        const dir = str(args.flags.root) ?? cwd;
        const { created } = initProject(dir);
        emit({ ok: true, created }, `initialized .aidw/ (${created.length} files)\n`);
        return 0;
      }

      case "change": {
        if (rest[0] !== "new") throw new UsageError("usage: aidw change new <id>");
        const p = project();
        const id = need(rest[1], "change id");
        const dir = newChange(p, id, { title: str(args.flags.title), inputType: str(args.flags["input-type"]) });
        emit({ ok: true, id, dir: rel(p, dir) }, `created change ${id} at ${rel(p, dir)}\n`);
        return 0;
      }

      case "status": {
        const p = project();
        const s = projectStatus(p, rest[0]);
        const lines = [
          `project  ${s.project}`,
          `specs    ${s.specs.capabilities} capabilities, ${s.specs.requirements} requirements`,
          s.changes.length ? "changes" : "changes  (none)",
          ...s.changes.map((c) => {
            if (c.error) return `  ${c.id}  ERROR ${c.error}`;
            const tasks = c.tasks ? `tasks ${c.tasks.done}/${c.tasks.total}` : "no tasks";
            const paused = c.paused ? `  paused(${c.paused.reason ?? "?"})` : "";
            const appr = c.approval === "drift" ? "APPROVAL DRIFT" : `approval ${c.approval}`;
            return `  ${c.id}  [${c.state}]  ${appr}  ${tasks}  deltas ${c.deltas}${paused}`;
          }),
        ];
        emit(s, `${lines.join("\n")}\n`);
        return 0;
      }

      case "validate": {
        const p = project();
        const d = new Diags();
        const checkOne = (id: string) => {
          d.add(checkChange(p, id));
          // Once the package is presented for approval, analyze findings are validation errors too.
          try {
            const state = loadChange(p, id).data.state;
            if (isState(state) && NEEDS_ANALYSIS.has(state)) d.add(analyzeChange(p, id));
          } catch {
            // load errors are already reported by checkChange
          }
        };
        if (rest[0]) checkOne(rest[0]);
        else {
          d.add(checkSpecs(p));
          for (const id of listChangeIds(p)) checkOne(id);
        }
        const strict = args.flags.strict === true;
        const failed = d.failed(strict);
        const summary = `${failed ? "FAILED" : "OK"}: ${d.errors.length} error(s), ${d.warnings.length} warning(s)${strict ? " (strict)" : ""}\n`;
        emit({ ok: !failed, strict, ...diagsJson(d) }, printDiags(d) + summary);
        return failed ? 1 : 0;
      }

      case "approve": {
        const p = project();
        const id = resolveChangeId(p, rest[0]);
        const { hash, files } = approve(p, id);
        emit({ ok: true, id, hash, files }, `approved ${id}\n  ${hash}\n  covers ${files.length} file(s)\n`);
        return 0;
      }

      case "approval": {
        if (rest[0] !== "check") throw new UsageError("usage: aidw approval check <id>");
        const p = project();
        const id = resolveChangeId(p, rest[1]);
        const c = loadChange(p, id);
        const a = approvalStatus(p, c);
        const files = computeApprovalHash(p, c).files;
        emit(
          { ok: a.status === "valid", id, ...a, files },
          a.status === "valid"
            ? `approval valid for ${id}\n`
            : a.status === "none"
              ? `${id} has no approval\n`
              : `APPROVAL DRIFT for ${id}\n  approved ${a.expected}\n  current  ${a.actual}\n`,
        );
        return a.status === "valid" ? 0 : 1;
      }

      case "transition": {
        const p = project();
        const id = need(rest[0], "change id");
        const to = need(rest[1], "target state");
        const r = transition(p, id, to, { reason: str(args.flags.reason) });
        emit({ ok: true, id, ...r }, `${id}: ${r.from} -> ${r.to}\n`);
        return 0;
      }

      case "merge": {
        const p = project();
        const id = resolveChangeId(p, rest[0]);
        const merges = planMerge(p, id);
        const write = args.flags.write === true;
        if (write) writeMerge(merges);
        const lines = merges.map((m) => {
          const s = m.summary;
          const parts = [
            s.added.length && `+${s.added.length} added`,
            s.modified.length && `~${s.modified.length} modified`,
            s.removed.length && `-${s.removed.length} removed`,
            s.renamed.length && `${s.renamed.length} renamed`,
          ].filter(Boolean);
          return `  ${m.capability}${m.created ? " (new)" : ""}: ${parts.join(", ") || "no changes"}`;
        });
        emit(
          { ok: true, id, written: write, merges: merges.map(({ text: _t, file, ...m }) => ({ ...m, file: rel(p, file) })) },
          `${write ? "merged" : "dry run (use --write to apply)"}: ${id}\n${lines.join("\n")}\n`,
        );
        return 0;
      }

      case "archive": {
        const p = project();
        const id = resolveChangeId(p, rest[0]);
        const { target, merges } = archiveChange(p, id);
        emit(
          { ok: true, id, archived: rel(p, target), capabilities: merges.map((m) => m.capability) },
          `archived ${id} -> ${rel(p, target)} (${merges.length} capability spec(s) updated)\n`,
        );
        return 0;
      }

      default:
        throw new UsageError(`unknown command "${cmd}"`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`aidw: ${e.message}\n\n${HELP}`);
      return 2;
    }
    if (e instanceof OpError || e instanceof ChangeError) {
      const d = e instanceof OpError ? e.diags : undefined;
      if (json) io.out(`${JSON.stringify({ ok: false, error: e.message, ...(d ? diagsJson(d) : {}) }, null, 2)}\n`);
      else io.err(`aidw: ${e.message}\n${d ? printDiags(d) : ""}`);
      return 1;
    }
    throw e;
  }
}

// Entry point when executed as the bundled bin (not when imported by tests).
if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = run(process.argv.slice(2), process.env, process.cwd(), {
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
    stdin: () => {
      try {
        return readFileSync(0, "utf8");
      } catch {
        return "";
      }
    },
  });
}
