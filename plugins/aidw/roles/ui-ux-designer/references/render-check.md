# Checking a mock on the rendered page

What the screen looks like is judged on screenshots, never from the markup.

## Shoot

```
aidw mock shots .aidw/design/mock/<direction-id>          # app screens: the first screen at each size
aidw mock shots .aidw/design/mock/<direction-id> --full   # landing pages: the whole height
```

Each `.html` in the folder is shot at 1440 × 900 and 390 × 844, in light and dark: four PNGs per page in `shots/`.
It uses the project's test browser; when the command says none is running, stop and report `aidw browser start`.
Open every PNG with Read. Look at all of them before fixing anything, so one round of fixes covers what they share.

## The checks, in order

Read the craft floor once: `aidw plugin-path library/vendor/impeccable/craft-floor.md` (notes on it:
`library/vendored-skill-notes.md`, "impeccable"). Then go through three tiers. A higher tier is not looked at while
a lower one fails.

### Floor: must pass, nothing lifts it

- The fetched faces are on screen: compare the letterforms with the direction's faces; a system font means the
  `@font-face` path or the family name is wrong. Vietnamese diacritics render in the same face.
- Text contrast meets the ratios written in `tokens.css`, in both themes; nothing is unreadable on an image.
- Nothing overflows, is clipped, or overlaps at 390 px; no sideways scroll; long titles wrap.
- One primary action, the most prominent control; it is reachable at the phone width without hunting.
- Focus is visible where it would land (shoot a page with a focused control when unsure).
- The dark theme is designed, not inverted: every surface and text token changed, the accent still works.
- The `quality` rules of `antipatterns.json` that a screenshot can show.

### Slop: must pass unless the direction lifts the rule

The `slop` rules of `aidw plugin-path library/vendor/impeccable/antipatterns.json` that a screenshot can show:
identical card grids, an eyebrow above each heading, gradient text, a colored side border, glass as decoration, a
hard offset shadow, monospace as a costume, glyphs for icons. Only an exception written in the direction lifts one,
for the reason written there.

### Finish: remarks, never a reason to loop

Rhythm (tight groups, generous separation, more space above a heading than below), the type scale held, the browser
surfaces themed, the one bold thing reading as the most memorable part, copy in the product's own words.

## After the checks

Fix Floor and Slop failures, shoot, look again: two rounds at most. Report every Floor or Slop failure left, with the
screen, viewport and theme, and the Finish remarks as remarks. Measured checks (contrast computed on the page, overflow
found by script) arrive with the Slop Check (ADR-0009); until then these checks are made by eye on the screenshots.
