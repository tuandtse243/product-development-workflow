# Upstream: pbakaus/impeccable

- Commit: `d41d9860b0094dcb68030657da63461212835aaa` (ref `main`)
- Synced: 2026-11-17
- License: see `LICENSE` (copied verbatim from upstream); third-party notices in `NOTICE.md`
- Role in aidw: The signs of a generic generated interface (rule catalog, craft floor) and interface wording and edge cases (clarify, harden): lookup material for the ui-ux-designer and frontend Roles (ADR-0005)

Vendored verbatim; aidw never edits these files. aidw-specific behavior lives in the
adapter instructions of the aidw skills that load them. Re-sync with
`node scripts/vendor.mjs impeccable` and review `git diff`.

## Files

- `craft-floor.md` <- `skill/reference/craft-floor.md`
- `antipatterns.json` <- `crates/live/assets/antipatterns.json`
- `clarify.md` <- `skill/reference/clarify.md`
- `harden.md` <- `skill/reference/harden.md`
