# The Direction Library

Examples of a Design Direction, accepted by the factory's owner (ADR-0008, amended 2026-11-18). They are not
candidates: the three directions for a product are composed for it. The examples show the format a composed
direction follows and the bar it must reach: a whole look with its reasons, written so that three Agents given
three different directions build three mocks that do not look alike.

An example enters the library as `status: proposed` and counts only after the owner has seen it on a preview and
set `status: accepted`. The owner may also send it back for changes or drop it.

## What a direction holds

- **Front matter**: `id`, `name`, `status`, `theme` (light-first or dark-first; both themes are always designed),
  `density`, `fits` and `avoid_for` (kinds of product the direction fits or should not be used for).
- **Character**: one paragraph a designer can hold in mind while choosing anything the file does not cover.
- **Palette**: tokens with light and dark values and their `use`, named as in `tokens.yaml`
  (`design-tokens.md`). The mock's CSS carries them; tokens are read from it after approval.
- **Type**: display, body and data faces, all under open licences (OFL) and fetched when the mock is built; the
  scale and where each face is used.
- **Space, shape, elevation**: the spacing unit and rhythm, radii, how one surface sits above another.
- **App screens** and **Landing pages**: the layout and component treatment for each Screen Kind.
- **Motion**: durations, easing, and the kinds of effect component it welcomes. Motion is not rationed (roadmap,
  step 2): the direction says where effects go, and that text lifts the Slop Check's motion rules.
- **Images and marks**: what kind of picture belongs, and what a mark looks like.
- **Slop Check exceptions**: rule ids from `library/vendor/impeccable/antipatterns.json` this direction lifts on
  purpose, each with its reason. Nothing else is lifted. Failures of use are never lifted.
- **Adapting to a subject**: what may change for a product (an accent hue, a face of the same kind) and what may not.

## Composing three directions

1. The `ui-ux-designer` asks the `research` Role for worlds outside software that fit the product's subject and
   users (print, signage, packaging, editorial, instruments, maps, ...), with pictures and sources. Live sites of
   the same kind of product are asked for only to learn its conventions (density, the screens it must have);
   they do not set the look.
2. In one context it composes three directions in the format above. Each borrows one whole world; no two share a
   world, and they differ in theme or density and in the kind of display face. None copies an example. A world may come back for another product or in another
   round; only the three of one round must differ.
3. Each is as complete as an example. A direction that is only a palette is not a direction.

## Examples

| id | name | status | theme | for |
|---|---|---|---|---|
| night-shift | Night Shift | accepted | dark-first | developer and power-user tools, analytics |
| playground | Playground | accepted | light-first | consumer, community, creators, learning for all ages |
| riso | Riso | accepted | light-first | events, publishing, creative tools, education, culture |

The examples kept each borrow a whole world (a night-shift tool, a sticker sheet, a print run). Directions the
owner did not keep as examples (Workbench, Tide, Color Field, Transit) are not banned: any world may be composed
for a product it fits.
