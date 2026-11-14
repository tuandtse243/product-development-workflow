# Permission tiers (decision D-08)

Every action the workflow takes falls in one tier. The Analysis lists every **tier 2** resource it needs
under `## Permissions`; the user approves that list together with the rest of the package.

| Tier | Examples | Rule |
|---|---|---|
| 0 | edit code, install packages, run tests, commit on the change branch | free after approval |
| 1 | Supabase local (CLI / Docker), local migrations, fake seed data | free after approval |
| 2 | free cloud resources: Supabase dev project, Vercel preview deploy, preview env vars | only when its key is in the approved allowlist |
| 3 | anything that costs money, production deploys, domains, real email or payments, deleting cloud data, pushing to any remote (client repos included) | always ask the user |
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

## How to write the Permissions section

```markdown
## Permissions

- `vercel-preview`: preview deployment of the demo (project: <name>), deleted after handoff.
- `supabase-dev`: Supabase dev project on the free plan for preview data.
```

Each key must also be in `quality.yaml` `permissions` (and vice versa); `aidw analyze` checks it. Write `None`
when the change needs no cloud resource.
