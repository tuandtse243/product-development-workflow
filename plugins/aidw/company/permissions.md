# Permission tiers (decision D-08)

Every action the workflow takes falls in one tier. The Analysis lists every **tier 2** resource it needs
under `## Permissions`; the user approves that list together with the rest of the package.

| Tier | Examples | Rule |
|---|---|---|
| 0 | edit code, install packages, run tests, commit on the change branch | free after approval |
| 1 | Supabase local (CLI / Docker), local migrations, fake seed data | free after approval |
| 2 | free cloud resources: Supabase dev project, Vercel preview deploy, preview env vars | only when its key is in the approved allowlist |
| 3 | anything that costs money, production deploys, domains, real email or payments, deleting cloud data, pushing to any remote (client repos included) | always ask the user; only the push of the Change Branch and its pull request can be granted at the Approval Gate |
| x | secrets outside the project's own `.env`, personal credentials (SSH, cloud CLIs, keychain) | never |

## Enforcement

- `aidw gate` (PreToolUse hook) denies tier x, asks for tier 3, and blocks project writes before approval.
- **Tier 2 allowlist:** each tier-2 resource has a key (`vercel-preview`, `netlify-preview`, `supabase-dev`).
  The approved `quality.yaml` lists the keys under `permissions`. While that change is open (approved,
  executing, verifying, converging, deploying, approval still valid), a matching command runs **without asking**;
  otherwise, or when chained with other commands, it asks. Subagents never touch cloud resources.
- `aidw deploy` runs only the approved preview command; production is never automatic.
- `aidw backstop` (Stop hook) surfaces file changes that slipped past the gate.
- Pattern lists live in `src/policy.ts`. They are a first line of defense, not a sandbox: when unsure
  whether an action is tier 2 or 3, treat it as tier 3 and ask.

## Grants at the Approval Gate (ADR-0012, ADR-0014)

The user grants, for one Change, in `quality.yaml` (part of the approved package: hashed, frozen, shown as the
"Grants for this Change" section of the gate Decision Page):

```yaml
grants:
  push:                # push the Change Branch to this remote and open one pull request (draft included) against this base
    remote: origin
    base: main
  envelope: true       # the wider permission envelope, below
  agent_runs: 30       # cap on Agent runs for the Change; leave it out for 3 per planned task
```

- **Push.** With `push`, the gate allows without asking, for the Orchestrator only (never a subagent), while the
  Change is open or delivered and its approval is valid: `git push [-u|--set-upstream] <remote> <branch>` (also
  `HEAD:<branch>`), `gh pr create --base <base> --head <branch>` with only `--title`, `--body`, `--body-file`,
  `--draft`, `--fill`, and `aidw pr <id> --create [--base <base>] [--draft]`. `<branch>` is the Change Branch
  (`run.branch`, else `aidw/<id>`) and never the base. Any other branch (a Task Worktree branch included), remote,
  base or flag (`--force`, `--repo`, `--no-verify`), and any command with shell chaining, substitution or globs,
  still asks. `aidw pr` uses the granted remote and base.
- **Envelope.** `envelope: true` adds any free resource of a provider the project already uses, and migrations that
  change data on local and dev databases when they are reversible and were tried on seed data first. A pattern cannot
  tell "free" apart, so the gate does not enforce it: it is written into every task brief and the gate page, and work
  outside it is marked not built, never done. Tier 2 commands still need their key in `permissions` to run without asking.
- **Cap.** `agent_runs` is recorded here; the run enforces it (at the cap no new task starts and the run ends cleanly).
- **Never automatic, whatever is granted:** credentials outside the project's own `.env`, anything that costs money,
  production deploys, deleting cloud data. `grants` has no key for them; an unknown key fails validation.

## How to write the Permissions section

```markdown
## Permissions

- `vercel-preview`: preview deployment of the demo (project: <name>), deleted after handoff.
- `supabase-dev`: Supabase dev project on the free plan for preview data.
```

Each key must also be in `quality.yaml` `permissions` (and vice versa); `aidw analyze` checks it. Write `None`
when the change needs no cloud resource.
