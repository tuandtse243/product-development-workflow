# aidw roadmap (review 2026-11-11)

Decided in a grilling session after a full plugin review. Order: batch 1 (safety and cheap fixes) → trial-3A →
batch 2 (features). Tick items as they land.

## Batch 1: safety and cheap fixes (before trial-3A)

- [ ] **MCP gate.** The PreToolUse matcher also covers `mcp__.*`. MCP tools with read-like names
  (`get|list|search|read|fetch|whoami`) pass; every other MCP tool asks. Before approval, only read-like
  MCP tools are allowed. (A per-server tier map comes later.)
- [ ] **Change branch.** Moving to `executing` creates `aidw/<change-id>` from the current commit, and task
  commits land there. If HEAD is already on a non-default branch, keep it and warn. Resume stays on the
  branch.
- [ ] **Implementer report.** The implementer writes `.aidw/run/report-<T>.md` only when it has something to
  say: a file outside Touches, a scenario loosened or skipped, or a note for the reviewer.
  `buildBrief(review)` includes it as "Implementer notes".
- [ ] **Vendor `pocock/codebase-design`.** `start` loads it in the Architecture step, and `tasks.yaml` lists it
  in `skills` for tasks that create a new module or interface. It is not loaded for every implementer.
- [ ] **Agent limits.**
  - Implementer: `disallowedTools: WebFetch, WebSearch`, plus `maxTurns`.
  - Reviewer roles: the gate denies Bash commands that write (redirects, `sed -i`, `rm`, installs).
  - Changing reviewer models is measured in the trial first.
- [ ] **Format fixes.**
  - `init`: description without trigger wording, and `start` no longer says "run /aidw:init".
  - `allowed-tools: Bash(aidw *)` on run, resume, status and deliver.
  - `plugin.json` gets `repository` (license stays UNLICENSED).
  - The implementer's prettier line becomes "the project's formatter".
- [ ] **Flaky retry.** A failed verify command runs once more. If it passes, evidence marks it `flaky`.
- [ ] **PostCompact hook.** Re-inject `aidw status --brief` after an auto-compact.
- [ ] **Docs.** README and user guide state "one change at a time" and "monorepo not supported yet".
- [ ] **Monorepo detection.** `detect` recognises `pnpm-workspace.yaml`, `turbo.json` and `nx.json`, and
  `init` warns.

## Trial-3A

- [ ] Run trial-3A and record pass/fail with evidence for every check in `docs/trial-3.md`, including waves,
  the runner, the ui/security reviewers and the new code-style scaffold (`.husky/`, `.prettierrc`,
  `format:check`).

## Batch 2: features (after trial-3A)

- [ ] **Stack packs** ([ADR-0001](adr/0001-stack-packs.md)).
  - Create `profiles/stacks/node.md` and move the JS knowledge there (`code-style.md` merges in).
  - `src/git.ts` reads junk paths per stack.
  - Python and Go packs come when a real project needs them.
- [ ] **`aidw doctor`.** Checks:
  - the binary of each `quality.yaml` command and the package manager;
  - CDP 9222 when a layer needs a browser;
  - `vercel whoami` for preview deploys;
  - a clean tree on the change branch.

  Called from `start` §8, `run` §0, `resume` and the runner. It replaces the prose preflight.
- [ ] **Small path.** `start` proposes `size: small | normal` and the user confirms at the gate. Small means:
  - at most 3 grilling questions;
  - no domain modelling, design tokens or ADRs;
  - at most 3 tasks;
  - layers `code` + `unit`, plus `e2e` when UI is touched;
  - a bugfix needs a regression test that fails first;
  - no deploy unless asked.
- [ ] **Re-approval keeps done work.** Going back to `analyzing` after approval keeps done tasks and their
  evidence. Only new or edited tasks run. Document the flow.
- [ ] **`aidw task reopen <T> [--revert]`.** It runs `git revert` on the task commit, sets the task back to
  pending and drops the evidence of layers that ran after it. Only the user or the orchestrator may call it.
- [ ] **PR at deliver (opt-in, tier 3).** Push the change branch and run `gh pr create`, with the body
  following vendored `pocock/pr` (Summary, Evidence from checkpoints and screenshots, Merge Danger). Add
  Merge Danger to `handoff.md`.
- [ ] **CI scaffold.** A workflow that mirrors the `code` and `unit` layers.
- [ ] **Migration rule.** DB migrations must be reversible and tested against a seeded DB.

## Backlog

- Per-server MCP tier map (for example Vercel deploy as tier 3).
- Monorepo support: package-scoped touches, verify and layers.
- Headless evals (`claude -p`) asserting analysis artifacts and `aidw cost` budgets.
- `/aidw:amend` with a delta Analysis, only if trial shows that re-approval is not enough.

## Rejected

- `handoff` skill: aidw's code-built briefs already carry context from primary sources. An LLM summary in
  `$TMPDIR` would cost tokens and live outside `.aidw/`.
- `improve-codebase-architecture` in the pipeline: it needs a human, and nobody is there after approval.
