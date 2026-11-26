---
id: night-shift
name: Night Shift
status: accepted
theme: dark-first
density: balanced
fits: [developer tools, analytics, power-user productivity, monitoring, finance back office]
avoid_for: [children, first-time consumers, print-heavy reading]
---

# Night Shift

**Character.** A tool for people who keep it open all day and drive it from the keyboard. Blue-slate surfaces
stepped by lightness, warm white text, amber for the one action that matters, and muted label colors to tell lists
apart. Keyboard shortcuts are shown where they apply. It should feel quick, quiet and in control.

## Palette

| token | dark | light | use |
|---|---|---|---|
| surface | `#11151C` | `#F3F5F8` | page background |
| surface-raised | `#1A2029` | `#FFFFFF` | panes, inputs |
| surface-raised-2 | `#232B36` | `#E9EDF2` | selected row, hovered item, menus |
| ink | `#E9EDF2` | `#11151C` | text and icons |
| ink-muted | `#9AA5B4` | `#556070` | secondary text, shortcut keys |
| line | `#2C3542` | `#D8DEE6` | pane dividers |
| amber | `#F2B33D` | `#F2B33D` | primary action fill, focus ring; text on it is `#1A1405` |
| amber-text | `#F2B33D` | `#8A5A00` | links and active labels |
| tag-rose | `#E58A9E` | `#B4415C` | a list label |
| tag-sky | `#7FB3E6` | `#2E6AA6` | a list label |
| tag-sage | `#8CC7A1` | `#2F7A4C` | a list label |
| late | `#FF7A6B` | `#C2361B` | late label |

## Type

- **Display and body**: Schibsted Grotesk; 700 for titles, 400 and 500 for text.
- **Data**: JetBrains Mono 400, only for times, IDs and shortcut keys.
- Scale: 12, 13, 14 (body), 16, 20, 32, 56.

## Space, shape, elevation

4px unit; rows 40px; 12 inside a row, 20 between groups. Radius 8px. Elevation is lightness: each raised surface is
one step lighter; no shadows except menus. A key is drawn as a small box with a 1px `line` border.

## App screens

Three panes: lists with color labels and counts, the task list, the selected task's detail. A command bar at the
top (search, jump, run) opened with ⌘K. Every row and action has a shortcut, shown on hover and in menus. Empty states
name the shortcut that fills them.

## Landing pages

Dark hero with a short headline, one sentence, the amber action, and the real product large below it, cropped by the
fold so the page invites a scroll. A strip that types a sequence of shortcuts and shows their effect.

## Motion

Crisp: 150 to 200 ms, ease-out, no spring. Welcome: a headline split into words that rise once on the landing page,
numbers that count, a command palette that opens with a quick scale-in, a typed demo of shortcuts. No glows, no
spotlight cards, no grain.

## Images and marks

Product screens rather than photos. The mark is a geometric glyph that reads at 16px, or a wordmark in the display
face.

## Slop Check exceptions

None lifted. Several hues are used, never cyan on dark and never a purple gradient (`ai-color-palette` holds).

## Adapting to a subject

Amber may move to a warm coral (`#FF8F6B`) or a clear green (`#4CC38A`) when the product's world calls for it; the
slate surfaces and the stepped elevation stay.
