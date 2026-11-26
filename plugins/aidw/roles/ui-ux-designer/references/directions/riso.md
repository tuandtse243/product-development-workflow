---
id: riso
name: Riso
status: accepted
theme: light-first
density: balanced
fits: [events, publishing, creative tools, education, community, culture, food and drink]
avoid_for: [finance back office, health records, legal, monitoring]
---

# Riso

**Character.** A risograph print run: two inks, fluorescent pink and process blue, pressed onto cool paper. Where
they overlap they make a third color. Tall condensed capitals shout the headline; a plain sans does the reading.
Halftone dots and a slight misregistration show that it was printed, not rendered. It should feel made by hand and
pinned to a wall.

## Palette

| token | light | dark | use |
|---|---|---|---|
| surface | `#F2F4F5` | `#14172B` | page background (paper) |
| surface-raised | `#FFFFFF` | `#1E2240` | panels, inputs |
| ink | `#1A1F3A` | `#F2F4F5` | text, outlines |
| ink-muted | `#4A5070` | `#A9AEC8` | secondary text |
| pink | `#FF48B0` | `#FF5DBA` | primary action fill, highlights; text on it is `ink` light value |
| blue | `#0072B5` | `#4AA8F0` | links, selected list, the second ink in shapes |
| overprint | pink and blue with `mix-blend-mode: multiply` | `screen` | where two shapes overlap; never set as a flat color |
| yellow | `#FFE800` | `#FFE94D` | rare third ink: a due marker, a sticker; text on it is `ink` light value |

## Type

- **Display**: Big Shoulders Display, weight 800 to 900, capitals; headlines, list names, big counts.
- **Body**: Instrument Sans 400 and 600.
- Scale: 13, 15 (body), 20, 28, 48, 96. Display tracking 0 to 0.01em, never negative.

## Space, shape, elevation

8px unit; 16 inside a panel, 32 between groups. Radius 4px; shapes in illustrations are full circles and blunt
rectangles. Elevation is ink, not shadow: a raised panel has a 2px `ink` outline, and a pink copy of a heading sits
2px off its blue copy where the direction wants emphasis.

## App screens

A list column printed in blue, the task list on white with 2px outlined rows grouped under condensed capitals, a pink
primary action, and a detail panel with a halftone corner. Counts are set large in the display face. Empty states
are a printed shape and one sentence.

## Landing pages

A poster: one huge condensed headline in two inks, overlapping circles behind it, a halftone photograph in blue, the
pink action, then sections that read like a program sheet (date, place, what happens).

## Motion

Short and inky: 180 to 260 ms. Welcome: the two inks of a headline sliding into register on load, halftone dots
growing on hover, a list that stamps in row by row once, a counter that rolls.

## Images and marks

Photographs converted to one-ink halftone in blue or pink (CSS filter or a pre-processed file). Flat shapes in the
two inks with overprint. The mark is a two-ink overlap of simple shapes or the name in condensed capitals.

## Slop Check exceptions

- `codex-grid-background`: halftone dot fields are this direction's printed texture. They sit behind images and
  shapes, never behind body text.

## Adapting to a subject

The pair of inks may change to another risograph pair (orange and teal, green and red) when the product's world
calls for it; overprint, halftone and the condensed capitals stay.
