---
name: deliver
description: Build the Complete Delivery Package of a delivered aidw change - handoff, quality report, screenshots, env template - open its pull request (ready or draft) and archive the change when it is ready. Use when the user runs /aidw:deliver; /aidw:run reads this file itself once the change is delivered.
allowed-tools: Bash(aidw *)
disable-model-invocation: true
argument-hint: "[change id]"
---

# aidw: deliver

The `aidw` CLI ships with this plugin as `${CLAUDE_PLUGIN_ROOT}/bin/aidw`. If a command fails with
`aidw: command not found`, run that path instead of `aidw` (here and in every command below).

The change is `delivered`: the code is final, verified and converged, and the deploy ran. Something may be not built
(a task, a quality layer, a scenario) or the deploy may have failed: then the run still ends here, in a **draft** pull
request that says so (ADR-0014, plan D12). You now package it for the client (blueprint section 14) and open the pull
request. Do not change product code: the gate only lets you write `.aidw/` and the
project's `.env.example` and `README.md`. Write every file with the Write tool: the gate denies a shell redirect or heredoc into a file
(`cat > file <<EOF`) and each denial costs a turn. `aidw archive` commits `README.md` and `.env.example` together with the
archive (its output lists them): do not tell the user they are uncommitted.

Read and apply, for the writing: `$(aidw vendor-path addy/documentation-and-adrs)` and
`$(aidw vendor-path addy/shipping-and-launch)` (handoff and launch checklists).

## 1. Generate

`aidw deliver --change <id>`. It writes, into `.aidw/changes/<id>/delivery/`, everything derivable from
evidence: `README.md` (contents, deploy status), `quality-report.md` (every layer, fix rounds, scenarios,
what was **not** covered), `tasks.md` (tasks, attempts, reviews, commits), `decisions.md`, and a
`handoff.md` skeleton (only if missing). Do not edit the generated files: they are regenerated each run.

## 1b. Release plan (drafting Agent)

Spawn **`aidw:release`** with this prompt and nothing else:
`Change <id> is delivered. Write .aidw/changes/<id>/release.md (release notes, deployment checklist, rollback, decision summary) as your Procedure says and reply with the path, the breaking changes and the irreversible steps.`
Use its file as the source for `## Deploy`, `## Merge danger` and `## Known issues` below; do not rewrite it. A
production deployment stays the user's decision and action.

## 2. Write handoff.md

Replace every `TODO(aidw)`; keep the headings. Sources: `analysis.md`, `.aidw/requirements/`,
`.aidw/architecture/overview.md`, `constitution.md`, `quality.yaml`, `package.json` scripts, the generated
quality report.

- `## Run locally`: exact commands, in order, that a developer runs on a clean machine (install, local
  services such as Supabase/Docker, dev server, tests).
- `## Environment`: every variable the **app** reads (search for `process.env.` / `import.meta.env.`), what it is
  for, where its value comes from. Variables only the tests use (a browser endpoint, a report path) belong under `## Run locally`,
  not here: listing them forces a `.env.example` for an app that needs none. If there are any, make sure the project root has `.env.example` with the
  names and **no real values**; create it if missing. If none, write `None`.
- `## Deploy`: list every deploy that happened, from `evidence/deploy.json` and anything the user ran by hand (for example `aidw first-deploy`, a failed `--prod`). Never write "Production was not touched" unless you checked (`vercel ls`): the user may have deployed by hand. What was deployed (target, URL from the quality report) and how the client deploys to
  production themselves. Production was not touched by this workflow.
- `## Usage`: the main user flows, referencing the screenshots.
- `## Known issues`: be honest. Include every item of the quality report's "Reviewer remarks (non-blocking)" (trial-3A dropped most of them, among them a missing focus trap), grouped by screen.
  Also: Copy every failed, skipped, not-built or not-covered item from `quality-report.md` (the pull request lists what
  was not built and why on its own; say here what it means for the client),
  reviewer remarks that were not fixed, files changed outside touches if relevant, and assumptions from the
  Analysis that the client must confirm. "None known" only if that is true.
- `## Merge danger`: what could break when this merges: migrations (reversible, tried on a seeded copy), new or
  changed environment variables, dependency upgrades, breaking API changes, data that must be moved. `aidw pr`
  prints the computed part (migration files, dependency and `.env.example` changes, breaking tasks); add what only
  you know. "None" only if true.
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

## 4. Check, pull request, archive

1. **Project documentation (drafting Agent).** Spawn **`aidw:documentation`** with this prompt and nothing else:
   `Change <id> is delivered. Bring the project's README.md and .env.example up to date as your Procedure says (and the API documentation when the project has an API others call), and reply with the files, the commands you could not run and the differences you found.`
   It may write only `README.md` and `.env.example` at this point. Put the differences it reports under `## Known issues`.
   Then `aidw deliver --change <id>` again (regenerates the package README with the screenshots), and
   `aidw deliver --check --change <id>`. Fix every item it reports. It also checks the **project's** README:
   every `npm run` / `pnpm <script>` it names must exist in package.json. Update the project README so its
   setup and test commands are the ones that work now (the handoff's Run locally section). If the project has
   no README, write one: what it is, Run locally, tests, the preview URL.
2. If the client asked for documentation in the repository (see intake), copy `handoff.md` to `docs/` only
   when the user confirms: after delivery, project writes outside `.env.example` need them.
3. **Pull request, before the archive** (D12). The push grant of the Approval Gate covers a delivered Change, not an
   archived one, so the pull request opens first:
   1. `aidw pr <id>`: writes the body to `.aidw/run/pr-<id>.md` and prints whether it is **ready** (everything passed,
      nothing not built) or a **draft** (with why), whether the push is **granted**, and a `NEXT:` line. The body opens
      with three fixed sections, filled by the CLI: what differs from the approved package (the Deviations), what was
      not built and why, and what is needed from the user to finish. Do not edit it.
   2. Run `aidw pr <id> --create` when the `NEXT:` line says so: granted, it does not ask; not granted, it asks the user.
      It commits the delivery package, pushes the Change Branch and opens the pull request (a draft when it is one), or
      updates the one open for the branch. It refuses when HEAD is not the Change Branch, when the remote moved since
      approval, or when the package holds a secrets file or a credential: report the refusal, do not work around it.
      Under `AIDW_RUNNER=1` with the push not granted, do **not** run it (it refuses there anyway): nobody can answer
      the question, and the `NEXT:` line already tells the user how to open it. Without a remote or `gh`, hand the user
      the body file.
4. **Ready**: `aidw archive <id>`: merges the delta specs into `.aidw/specs/`, moves the change to `.aidw/archive/` and
   commits `.aidw/` (when the pull request was opened with the grant, it pushes that commit to it too). It refuses an
   incomplete package, and, with the push granted, a Change whose pull request is not open yet. **Draft**: do not
   archive (`aidw archive` refuses a draft; only the user archives one as it is, with `--force`, which asks them and is
   refused unattended). The Change stays `delivered` so `/aidw:resume <id>` can finish it after the user acted on "Needed
   from the user to finish", and update the same pull request. **Ready but not opened** (the push not granted, under
   `AIDW_RUNNER=1`): do not archive either; the user opens the pull request, then archives.
5. Report to the user: the pull request (its link, ready or draft, or where its body is and the `NEXT:` line), the
   preview URL, where the package is (`.aidw/archive/<id>/delivery/`, or `.aidw/changes/<id>/delivery/` for a draft),
   the quality summary, and the known issues. Name the branch that holds the work (`run.branch` in change.yaml,
   usually `aidw/<id>`) and its base. aidw never merges.
6. Tell the user to `/clear` (or open a new session) before the next change: this session's context is large
   and a new change does not need it.
