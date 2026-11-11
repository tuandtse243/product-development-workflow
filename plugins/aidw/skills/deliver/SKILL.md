---
name: deliver
description: Build the Complete Delivery Package of a delivered aidw change - handoff, quality report, screenshots, env template - and archive the change. Use when the user runs /aidw:deliver, or from /aidw:run once the change is delivered.
disable-model-invocation: true
argument-hint: "[change id]"
---

# aidw: deliver

The `aidw` CLI ships with this plugin as `${CLAUDE_PLUGIN_ROOT}/bin/aidw`. If a command fails with
`aidw: command not found`, run that path instead of `aidw` (here and in every command below).

The change is `delivered`: the code is final, verified, converged and deployed. You now package it for the
client (blueprint section 14). Do not change product code: the gate only lets you write `.aidw/` and the
project's `.env.example`.

Read and apply, for the writing: `$(aidw vendor-path addy/documentation-and-adrs)` and
`$(aidw vendor-path addy/shipping-and-launch)` (handoff and launch checklists).

## 1. Generate

`aidw deliver --change <id>`. It writes, into `.aidw/changes/<id>/delivery/`, everything derivable from
evidence: `README.md` (contents, deploy status), `quality-report.md` (every layer, fix rounds, scenarios,
what was **not** covered), `tasks.md` (tasks, attempts, reviews, commits), `decisions.md`, and a
`handoff.md` skeleton (only if missing). Do not edit the generated files: they are regenerated each run.

## 2. Write handoff.md

Replace every `TODO(aidw)`; keep the headings. Sources: `analysis.md`, `.aidw/requirements/`,
`.aidw/architecture/overview.md`, `constitution.md`, `quality.yaml`, `package.json` scripts, the generated
quality report.

- `## Run locally`: exact commands, in order, that a developer runs on a clean machine (install, local
  services such as Supabase/Docker, dev server, tests).
- `## Environment`: every variable the code reads (search for `process.env.` / `import.meta.env.`), what it is
  for, where its value comes from. If there are any, make sure the project root has `.env.example` with the
  names and **no real values**; create it if missing. If none, write `None`.
- `## Deploy`: what was deployed (target, URL from the quality report) and how the client deploys to
  production themselves. Production was not touched by this workflow.
- `## Usage`: the main user flows, referencing the screenshots.
- `## Known issues`: be honest. Copy every failed, skipped or not-covered item from `quality-report.md`,
  reviewer remarks that were not fixed, files changed outside touches if relevant, and assumptions from the
  Analysis that the client must confirm. "None known" only if that is true.
- `## Next steps`: what you would do next, in priority order.

## 3. Screenshots (UI changes)

`aidw deliver` seeds `screenshots/` with the reviewed task screenshots (two per UI task). Look at them: if they
cover the main flows, keep them. Otherwise capture the missing flows yourself (one image per key screen, desktop
width; add mobile for the most important one):

1. Write a small Playwright script under `.aidw/run/` (it resolves `playwright` from the project's
   `node_modules`). Target the preview URL from the quality report, or start the app locally the way
   `## Run locally` says.
2. Save PNGs to `.aidw/changes/<id>/delivery/screenshots/` named `NN-<flow>.png` (e.g. `01-book-appointment.png`).
3. Use only fake demo data. Never screenshot secrets, real customer data or admin credentials.

## 4. Check and archive

1. `aidw deliver --change <id>` again (regenerates README with the screenshots), then
   `aidw deliver --check --change <id>`. Fix every item it reports. It also checks the **project's** README:
   every `npm run` / `pnpm <script>` it names must exist in package.json. Update the project README so its
   setup and test commands are the ones that work now (the handoff's Run locally section). If the project has
   no README, write one: what it is, Run locally, tests, the preview URL.
2. If the client asked for documentation in the repository (see intake), copy `handoff.md` to `docs/` only
   when the user confirms: after delivery, project writes outside `.env.example` need them.
3. `aidw archive <id>`: merges the delta specs into `.aidw/specs/`, moves the change to `.aidw/archive/` and
   commits `.aidw/`. It refuses an incomplete package.
4. Report to the user: the preview URL, where the package is (`.aidw/archive/<id>/delivery/`), the quality
   summary, and the known issues. Name the branch that holds the work (`run.branch` in change.yaml,
   usually `aidw/<id>`) and its base: the user merges it, or opens a PR from it. aidw does not merge or push.
5. Tell the user to `/clear` (or open a new session) before the next change: this session's context is large
   and a new change does not need it.
