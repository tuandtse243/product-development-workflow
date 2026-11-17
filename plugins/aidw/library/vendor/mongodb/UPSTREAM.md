# Upstream: mongodb/agent-skills

- Commit: `d649b461ece46f485f86f069d4220e61e6df68f6` (ref `main`)
- Synced: 2026-11-17
- License: see `LICENSE` (copied verbatim from upstream)
- Role in aidw: MongoDB's own schema design patterns, the lookup material of the database-architect Role (ADR-0005)

Vendored verbatim; aidw never edits these files. aidw-specific behavior lives in the
adapter instructions of the aidw skills that load them. Re-sync with
`node scripts/vendor.mjs mongodb` and review `git diff`.

## Skills

- `mongodb-schema-design` <- `plugins/mongodb/skills/mongodb-schema-design`
