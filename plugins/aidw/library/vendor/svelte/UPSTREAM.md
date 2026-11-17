# Upstream: sveltejs/ai-tools

- Commit: `d3e755be770277d8c75fe61109b103b801b12775` (ref `main`)
- Synced: 2026-11-17
- License: see `LICENSE` (copied verbatim from upstream)
- Role in aidw: Svelte's own guidance, loaded with the SvelteKit framework pack (ADR-0005)

Vendored verbatim; aidw never edits these files. aidw-specific behavior lives in the
adapter instructions of the aidw skills that load them. Re-sync with
`node scripts/vendor.mjs svelte` and review `git diff`.

## Skills

- `svelte-core-bestpractices` <- `tools/skills/svelte-core-bestpractices`
