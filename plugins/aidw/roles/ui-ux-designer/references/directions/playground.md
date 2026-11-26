---
id: playground
name: Playground
status: accepted
theme: light-first
density: balanced
fits: [consumer apps, community, creators, events, learning for all ages, games around a product]
avoid_for: [finance, health records, legal, enterprise admin]
---

# Playground

**Character.** A sticker sheet on a white table: four loud colors, thick ink outlines, solid offset shadows, and big
friendly letters. Things look pressable because they are. Finishing something is a small celebration. It should
make people want to open it with friends.

## Palette

| token | light | dark | use |
|---|---|---|---|
| surface | `#FFFFFF` | `#1B1B1F` | page background |
| surface-raised | `#FFFFFF` | `#26262C` | panels and inputs, always with a 2px `ink` outline |
| ink | `#1B1B1F` | `#FFFFFF` | text, outlines, offset shadows |
| ink-muted | `#5A5A66` | `#B9B9C6` | secondary text |
| tomato | `#FF5A36` | `#FF6E4D` | primary action, with `#1B1B1F` text |
| cobalt | `#2F5BFF` | `#6E8BFF` | links, selected list; white text on it (light) |
| sunflower | `#FFC93C` | `#FFD45E` | highlights, badges, with `#1B1B1F` text |
| mint | `#3CCB8E` | `#4ED89C` | done, progress, with `#1B1B1F` text |

Each list owns one of the four colors. Never more than two of them in one control.

## Type

- **Display**: Bricolage Grotesque at a large optical size, weight 800; short headlines, list names, counts.
- **Body**: Onest 400 and 600.
- Scale with big jumps: 13, 15 (body), 22, 32, 56, 88.

## Space, shape, elevation

8px unit; 16 inside a panel, 32 between groups. Radius 16px on panels, 999px on chips and checkboxes. Elevation is
a solid offset shadow of 4px 4px in `ink` with no blur; pressed controls lose it and move 2px.

## App screens

A top bar with the board's name, lists as large colored tabs, tasks as rows with a fat round checkbox inside one
outlined panel, a chunky progress bar ("2 of 6 done"), and a big tomato add button. Completing a task bursts a few
sparks in the list's color. Empty states are a friendly sentence and the action.

## Landing pages

Big headline of a few words, color blocks behind sections, one or two slightly rotated stickers carrying real facts
(price, platform), and the product shown inside an outlined, shadowed frame.

## Motion

Springy and short: 200 to 300 ms with a small overshoot. Welcome: sparks on completion, a magnetic primary button
on the landing page, list tabs that bounce on select, a progress bar that springs, headlines that pop in word by
word once.

## Images and marks

Flat illustrations in the four colors with ink outlines (open-licence sets such as Open Peeps, recolored), cut-out
photos with a thick white edge. The mark is a chunky shape in one of the four colors with an ink outline.

## Slop Check exceptions

- `hard-offset-shadow`: the solid offset shadow is this direction's elevation system, not a costume.
- `bounce-easing`: overshoot is part of how controls answer; it stays within 300 ms and off for reduced motion.

## Adapting to a subject

One of the four colors may be swapped for a hue the subject owns (a club's color, a brand color) if it keeps
contrast with ink. Outlines, offset shadows and the round shapes stay.
