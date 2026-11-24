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
- **Roles that may not write by Bash** (read-only reviewers, `artifacts` authors) may not hand code to an
  interpreter either: `node -e`/`-p`/`--eval`/`--print`, `python -c`, `perl`/`ruby -e` (also `-pe`, `-lne`),
  `php -r`, `deno eval`, `bun -e`, `sh`/`bash -c` (also `-lc`, `-ec`), `eval`, code piped or redirected into an
  interpreter, or a script under `.aidw/` outside a task's worktree. Commands are found behind environment
  assignments, `env`, `time`, `command`, `nice`, `timeout <n>`, `{`, `then`/`do`/`else` and quotes; quoted text (a
  commit message, a grep pattern) is never read as a command. The project's own scripts and test runners still run,
  with loader flags too (`node --import tsx --test`, `node -r dotenv/config`, `ruby -Itest`, `perl -MTest::More`).
- An implementer's Bash command is denied when one of its **write targets** (redirect targets, `tee` arguments, the
  last argument of `cp`/`mv`/`ln`/`install`, the arguments of `rm`/`touch`/`mkdir`/`sed -i`, `find -delete` roots,
  `dd of=`, path-like words of inline code) is `.aidw/` (other than its task worktree, `run/shots/` and its
  `report-<task>.md`), a verdict under `run/` or `../`, or `plan-review.yaml`, as the Write tool denies it. Copying
  out of `.aidw/` (the approved mock's fonts and images) is fine.
- Protected paths are compared without case (macOS and Windows file systems take `.AIDW/Run` for `.aidw/run`): the
  frozen package, `.aidw/` for implementers, task worktrees, personal credentials. Allows keep the exact case.
- A command the gate splits into words to allow it (a granted push, the runner start, a tier 2 command, an aidw
  command) must hold no whitespace but space and tab and no control or format character (NBSP, `\v`, U+3000,
  U+200B, U+FEFF...): the shell does not split where JavaScript would, so such a command asks or gets the full checks.
- `aidw deploy` runs only the approved preview command; production is never automatic.
- `aidw backstop` (Stop hook) surfaces file changes that slipped past the gate.
- Pattern lists live in `src/policy.ts`. The Bash patterns are best effort (a shell can always say a write in a way a
  pattern does not read); the backstop is the Stop hook, `aidw backstop`. They are a first line of defense, not a sandbox: when unsure
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

- **Push.** `aidw approve` fixes the Change Branch (the one the build will commit on: the recorded `run.branch`, the
  feature branch the project is on, else `aidw/<id>`), the remote and its URL, and the base in `approval.push` in
  change.yaml, hashed with the package (editing it is drift). A branch that is not a plain name, starts with `refs/`,
  is the default branch, is the base, or is a Task Worktree branch gets no binding, and the push asks; the gate page
  shows the branch before approval. With the binding, the gate allows without asking, only for the Orchestrator (any
  agent, an aidw Role or not, still asks), only in the project's own repository (not another or a nested one) and
  outside Task Worktrees, while the Change is open or delivered with a valid approval, the remote's push URL is still
  the one recorded at approval, and no `remote.<name>.push`, `remote.<name>.mirror` or `pushInsteadOf` could send the
  branch elsewhere: `git push [-u|--set-upstream] <remote> <branch>`
  (`refs/heads/<branch>` allowed, `HEAD:` not), `gh pr create --base <base> --head <branch>` with only `--title`,
  `--body`, `--draft`, `--fill`, `--repo <owner/repo of the remote>` and `--body-file .aidw/run/pr-<id>.md` (the body
  `aidw pr` writes, a regular file and not a symlink; no other file leaves the machine), and the aidw CLI's `aidw pr <id> --create [--base <base>]
  [--draft]` (bare `aidw` or the plugin's `bin/aidw`, no other program of that name). Anything else (another branch,
  remote or base, `--force`, `--no-verify`, `git -C`, shell chaining, substitution or globs) still asks. Pushing a Task
  Worktree branch (`aidw/<id>.T<n>`) is denied, granted or not. `aidw pr` pushes the branch, remote and base fixed at
  approval and passes `--repo` for a GitHub remote; its grant holds only while `run.branch` still names that branch.
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
