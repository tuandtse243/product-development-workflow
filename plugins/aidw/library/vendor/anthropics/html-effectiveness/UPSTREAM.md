# Upstream: anthropics/html-effectiveness

- Commit: `58c305be97f47b26b678f2c07dec01d4242268ec` (ref `main`)
- Synced: 2026-11-26
- License: see `LICENSE` (copied verbatim from upstream)
- Role in aidw: The 20 example pages every aidw HTML page is modelled on, through the html-pages skill (ADR-0017, ADR-0005)

Vendored verbatim; aidw never edits these files. aidw-specific behavior lives in the
adapter instructions of the aidw skills that load them. Re-sync with
`node scripts/vendor.mjs html-effectiveness` and review `git diff`.

## Files

- `01-exploration-code-approaches.html` <- `01-exploration-code-approaches.html`
- `02-exploration-visual-designs.html` <- `02-exploration-visual-designs.html`
- `03-code-review-pr.html` <- `03-code-review-pr.html`
- `04-code-understanding.html` <- `04-code-understanding.html`
- `05-design-system.html` <- `05-design-system.html`
- `06-component-variants.html` <- `06-component-variants.html`
- `07-prototype-animation.html` <- `07-prototype-animation.html`
- `08-prototype-interaction.html` <- `08-prototype-interaction.html`
- `09-slide-deck.html` <- `09-slide-deck.html`
- `10-svg-illustrations.html` <- `10-svg-illustrations.html`
- `11-status-report.html` <- `11-status-report.html`
- `12-incident-report.html` <- `12-incident-report.html`
- `13-flowchart-diagram.html` <- `13-flowchart-diagram.html`
- `14-research-feature-explainer.html` <- `14-research-feature-explainer.html`
- `15-research-concept-explainer.html` <- `15-research-concept-explainer.html`
- `16-implementation-plan.html` <- `16-implementation-plan.html`
- `17-pr-writeup.html` <- `17-pr-writeup.html`
- `18-editor-triage-board.html` <- `18-editor-triage-board.html`
- `19-editor-feature-flags.html` <- `19-editor-feature-flags.html`
- `20-editor-prompt-tuner.html` <- `20-editor-prompt-tuner.html`
