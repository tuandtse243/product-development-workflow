# Upstream: obra/superpowers

- Commit: `22f0b463e7a5e579904dd6211a520321035526f7` (ref `main`)
- Synced: 2026-11-17
- License: see `LICENSE` (copied verbatim from upstream)
- Role in aidw: Working discipline of every implementing Role: verify before claiming done, debug systematically, take review feedback (ADR-0005)

Vendored verbatim; aidw never edits these files. aidw-specific behavior lives in the
adapter instructions of the aidw skills that load them. Re-sync with
`node scripts/vendor.mjs obra` and review `git diff`.

## Skills

- `verification-before-completion` <- `skills/verification-before-completion`
- `systematic-debugging` <- `skills/systematic-debugging`
- `receiving-code-review` <- `skills/receiving-code-review`
