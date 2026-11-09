# aidw — AI Fullstack Autonomous Development Workflow

Analysis-gated autonomous development for Claude Code: intake → analysis → **one approval gate** →
autonomous build → layered quality gates → living specs → complete delivery package.

- Design and decisions: [`docs/blueprint-v1.md`](docs/blueprint-v1.md), [`docs/decisions-log.md`](docs/decisions-log.md)
- Status: **S1 done** (deterministic core CLI), **S2 code done** (analysis skills, analyze, approval gate hook,
  stop backstop, vendored Pocock and Addy skills), **S3 code done** (sequential orchestrator: a fresh
  implementer per task, scenario evidence, independent reviewer, a commit per task, resume), **S4 code done**
  (quality layers from the approved `quality.yaml`, failing layers become fix tasks, preview deploy with smoke
  checks, tier-2 allowlist), **S5 code done** (converge from JUnit reports, delivery package, archive). All
  milestone-A code is in and ran end to end in Claude Code (blueprint section 27). **S6 code done** (design tokens with
  use rules for all four design modes, checkpoint token and screenshot checks, reviewer design and
  decisions-to-honor checks, README command check at delivery). Test guide: [`docs/milestone-a-test.md`](docs/milestone-a-test.md)
  (set `AIDW_HOOK_LOG=<file>` to trace every hook call).

## Use it in a project (local, no install)

```bash
cd my-new-project && git init
claude --plugin-dir /path/to/product-development-workflow/plugins/aidw
# then in Claude Code:
/aidw:init
/aidw:start <idea, or a path to a PRD / Upwork JD>
/aidw:approve
/aidw:run        # autonomous build of the approved task graph
/aidw:resume     # after a killed session, a rate limit or a resolved escalation
/aidw:deliver    # delivery package + archive (run calls it at the end)
```

## Vendored skills

Selected skills from `mattpocock/skills` and `addyosmani/agent-skills` (both MIT) live verbatim in
`plugins/aidw/vendor/`; see each `UPSTREAM.md`. Update with `node scripts/vendor.mjs <pocock|addy>` and review
the diff. They sit outside `skills/`, so Claude Code never auto-loads them; aidw skills load them by path.

## Layout

```
.claude-plugin/marketplace.json   this repo is a Claude Code marketplace
plugins/aidw/                     the plugin (bin/aidw is the bundled CLI)
src/                              TypeScript source of the aidw CLI
tests/                            vitest suites
docs/                             blueprint and decisions log
```

## Develop

```bash
npm install
npm test            # builds plugins/aidw/bin/aidw, then runs vitest
npm run typecheck
```

`plugins/aidw/bin/aidw` is a single bundled file with no runtime dependencies; rebuild it with
`npm run build` and commit it together with the source change.

Try the plugin locally without installing: `claude --plugin-dir ./plugins/aidw`.

## CLI

```
aidw init                                    create .aidw/ in a project
aidw change new <id> [--title T] [--input-type idea|prd|upwork_jd|client_request|codebase]
aidw status [<id>] [--json]
aidw validate [<id>] [--strict] [--json]     specs + changes, with merge preflight
aidw approve <id>                            hash the Analysis package (awaiting_approval -> approved)
aidw approval check <id>                     exit 1 on drift
aidw transition <id> <state|resume> [--reason R]
aidw merge <id> [--write]                    delta specs -> .aidw/specs (dry run by default)
aidw archive <id>                            delivered -> merged specs + .aidw/archive/
aidw analyze [<id>]                          pre-gate consistency (analysis.md, task coverage of specs)
aidw ids [<id>]                              requirement / scenario ids after the change
aidw vendor-path <upstream>/<skill>          path of a vendored SKILL.md
aidw plugin-path <path>                      path of a plugin file
aidw next [--change <id>]                    orchestrator's next step: implement | review | escalate | complete
aidw task start|retry <task>                 running (attempts, base commit) | user-granted retry
aidw brief <task> [--for implement|review]   context packet for a fresh subagent (prints its path)
aidw skills <task> [--for implement|review]  vendored skills selected for the task
aidw checkpoint <task> [--timeout <sec>]     a test per scenario id + every verify command passes
aidw review <task> pass|fix [--notes-file F] independent verdict; pass marks done and commits
aidw verify [--layer L] [--fresh]            quality layers not yet passing; a failure adds a fix task
aidw converge                                every changed scenario has a passing test; gaps become tasks
aidw deploy                                  approved preview deploy + smoke checks (or record none/local)
aidw deliver [--check]                       delivery package (generated parts + handoff skeleton), checklist
aidw gate | backstop | stop-failure          hook entry points (JSON on stdin)
```
