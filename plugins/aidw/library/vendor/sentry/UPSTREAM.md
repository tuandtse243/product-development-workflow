# Upstream: getsentry/skills

- Commit: `a582c51ee29d0f35e6ac321340796f77d43da733` (ref `main`)
- Synced: 2026-11-17
- License: see `LICENSE` (copied verbatim from upstream)
- Role in aidw: Security review of GitHub Actions workflows for the devops and security Roles (ADR-0005)

Vendored verbatim; aidw never edits these files. aidw-specific behavior lives in the
adapter instructions of the aidw skills that load them. Re-sync with
`node scripts/vendor.mjs sentry` and review `git diff`.

## Skills

- `gha-security-review` <- `skills/gha-security-review`
