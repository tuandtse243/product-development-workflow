# Design Mock files

One folder per direction, served as a site when it is shot, frozen as an Artifact when it is approved (ADR-0008).

```
.aidw/design/mock/<direction-id>/
  tokens.css        the plan comment, then every token as a custom property
  base.css          element defaults, browser surfaces, layout primitives
  main.html         the main screen (candidate mode: the only screen)
  secondary.html    extend mode: the secondary screen
  landing.html      extend mode: the landing page, when the product has one
  main-empty.html   extend mode: states of the main screen (main-error.html, ...)
  fonts/            from `aidw mock font`: <id>.css, <id>/*.woff2, <id>/SOURCE.md
  images/           pictures used by the mock
  CREDITS.md        one line per image: file, title, author, source URL, licence
  shots/            from `aidw mock shots`; replaced on every shot
```

Every path inside the mock is relative (`fonts/instrument-sans.css`, `images/hall.jpg`). Nothing loads from another
host: no CDN, no font service, no hotlinked image. A page links its CSS in this order: the fonts' CSS, `tokens.css`,
`base.css`, then a `<style>` for what belongs to that page alone.

## Tokens in CSS

After approval the tokens are read from `tokens.css` into `tokens.yaml` (`design-tokens.md`), so the CSS is written
to be read:

```css
/* direction: riso | world: a risograph print run
   layout: a list column printed in blue beside the day's tasks on white
   bold: the condensed two-ink headline of the day
   exceptions: codex-grid-background (halftone behind images)
   primary action: Thêm việc */
:root {
  --surface: #F2F4F5;        /* use: page background (paper) */
  --ink: #1A1F3A;            /* use: text, outlines | 14.6:1 on surface */
  --pink: #FF48B0;           /* use: primary action fill; text on it is ink */
  --font-display: "Big Shoulders Display", "Arial Narrow", sans-serif;  /* use: headlines, counts */
  --radius-panel: 4px;       /* use: panels, inputs */
  --motion-short: 200ms;     /* use: hover, press */
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --surface: #14172B; --ink: #F2F4F5; --pink: #FF5DBA; color-scheme: dark; }
}
:root[data-theme="dark"] { --surface: #14172B; --ink: #F2F4F5; --pink: #FF5DBA; color-scheme: dark; }
```

- A property name is the token name, in kebab-case, without a kind prefix for colors (`--surface`, `--accent`) and
  with one for the rest (`--font-body`, `--space-2`, `--radius-card`, `--shadow-raised`, `--motion-short`).
- Each declaration carries a `use:` comment naming visible things; a text color adds its contrast ratio.
- A dark-first direction mirrors the shape: dark values on `:root`, light ones under `prefers-color-scheme: light`.
- The fallback after a face is of the same kind (a condensed face falls back to a condensed one). The fallback is
  for a failed load, never the design: the shots must show the fetched face.

## Images

Only pictures whose licence allows reuse: CC0, public domain or CC BY (credited in `CREDITS.md`), or drawn by you as
geometry in SVG. No realistic face stands in for a customer or a testimonial. Until the image script exists (roadmap,
step 1), take a picture only from a source the research note cites with its licence; otherwise use the direction's
non-photographic treatment.
