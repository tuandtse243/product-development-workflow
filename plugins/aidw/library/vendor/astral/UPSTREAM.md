# Upstream: astral-sh/agent-plugins

- Commit: `855418fb9ebfada49a8345a5c3ada9db2cdc2419` (ref `main`)
- Synced: 2026-11-17
- License: see `LICENSE` (copied verbatim from upstream)
- Role in aidw: uv and ruff guidance from their makers, loaded with the Python framework packs (ADR-0005)

Vendored verbatim; aidw never edits these files. aidw-specific behavior lives in the
adapter instructions of the aidw skills that load them. Re-sync with
`node scripts/vendor.mjs astral` and review `git diff`.

## Skills

- `uv` <- `plugins/astral/skills/uv`
- `ruff` <- `plugins/astral/skills/ruff`
