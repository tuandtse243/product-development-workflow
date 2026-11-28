# Upstream: humanlayer/skills

- Commit: `4d69d20f6e9b57b4fcf0d501ccfb1be961f0f329` (ref `main`)
- Synced: 2026-11-26
- License: see `LICENSE` (copied verbatim from upstream)
- Role in aidw: How to show a point with the smallest View (pseudocode, call tree, file tree, diff, Mermaid, one HTML page): used for every question put to the user (ADR-0017, ADR-0005)

Vendored verbatim; aidw never edits these files. aidw-specific behavior lives in the
adapter instructions of the aidw skills that load them. Re-sync with
`node scripts/vendor.mjs humanlayer` and review `git diff`.

## Skills

- `show-me` <- `plugins/show-me/skills/show-me`
