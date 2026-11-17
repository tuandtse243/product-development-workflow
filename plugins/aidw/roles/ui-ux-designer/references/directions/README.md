# The Direction Library

The Design Directions aidw deals from when it designs a product (ADR-0008). Each file is one direction: a whole
look with its reasons, written so that three Agents given three different directions build three mocks that do not
look alike.

A direction enters the library as `status: proposed` and is used only after the factory's owner has seen it on a
preview and set `status: accepted`. The owner may also send it back for changes or drop it.

## What a direction holds

- **Front matter**: `id`, `name`, `status`, `theme` (light-first or dark-first; both themes are always designed),
  `density`, `fits` and `avoid_for` (kinds of product, used when dealing).
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

## Dealing

The library holds three directions, so every product is dealt all three and the user chooses. `avoid_for` is
shown to the user beside a direction that names the product's kind; it does not remove it. A record of dealt
directions (`~/.aidw/`) comes only when the library holds more than three. References found by the `research` Role adjust a
dealt direction to the kind of product; they do not replace it.

## Directions

| id | name | status | theme | for |
|---|---|---|---|---|
| night-shift | Night Shift | accepted | dark-first | developer and power-user tools, analytics |
| playground | Playground | accepted | light-first | consumer, community, creators, learning for all ages |
| riso | Riso | accepted | light-first | events, publishing, creative tools, education, culture |

Dropped by the owner on 2026-11-18, so as not to be written again: a dense utilitarian light direction (concrete
grey, signal yellow, wide grotesque), a calm airy light direction (mist, spruce, upright book serif), and a
saturated color-field direction (ultramarine ground, flat white panels, lime action, wide rounded display). A fourth, Transit (transit signage, line colors, a route of stations), was
withdrawn when the library was fixed at three. The
directions kept each borrow a whole world (a night-shift tool, a sticker sheet, a print run).
