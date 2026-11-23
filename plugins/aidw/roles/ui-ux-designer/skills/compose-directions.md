---
name: compose-directions
description: Compose the three Design Directions of one round for a product, each borrowing one whole world from the research note, distinct from each other and as complete as the accepted examples.
---

# Compose three directions

You write the three candidates the user will choose from. Each becomes a Design Mock built by another Agent that
sees only that one file, so a direction must hold every decision a designer would otherwise make by habit. Three
weak directions waste three mocks; you are the place where blandness is stopped.

Read first: the product's requirements, the `world-scan` note of the `research` Role (`.aidw/research/worlds.md`),
and the Direction Library: `aidw plugin-path roles/ui-ux-designer/references/directions/README.md` and the three
examples it lists. The examples set the format and the bar. Never copy one, and never take its world.

## 1. The subject and the scene

Write four lines before choosing anything:

- **Subject**: what the product is about, in the user's words, not the category ("a shift board for a bakery's
  morning crew", not "a task manager").
- **People**: who uses it, how often, how expert they are.
- **Scene**: where and when they use it, on what screen, under what light. Light or dark comes from the scene
  ("a dim control room at night", "a phone in a sunny market"), never from the category.
- **Job of the main screen**: what a person must be able to do there in the first ten seconds.

## 2. Choose three worlds

A world is a place, a trade or a printed thing with its own materials, tools and conventions: a night-shift
console, a sticker sheet, a risograph run. Take the candidates from the research note; add your own only when the
note has fewer than three that pass.

Keep a world only when it passes all three tests:

1. **Concrete**: you can name a material, a tool and a convention that belong to it (paper stock and ink, a
   stencil, how a ticket numbers its seats). Three adjectives ("clean, modern, friendly") are not a world.
2. **Tied to this product**: a sentence connects it to the subject, the people or the scene.
3. **The neighbour test**: imagine the nearest other product (another to-do app, another booking site). If it would
   get the same world from the same reasoning, the world is generic; find one tied closer to this subject.

Then pick three worlds that pull in different directions: one close to the subject, one from the people's own
surroundings, one lateral (a world that shares a quality with the product but not its trade). A world used for
another product or in another round may come back; only the three of this round must differ.

## 3. The world sets the material, the job sets the layout

From the world take the palette, the type, the surfaces, the texture, the motion and the kind of picture. From the
product's job and the conventions in the research note (traits shared by at least three live products of the same
kind) take what the screen must contain and where a user expects it. A direction then treats that structure in its
world's way: a list may become a ledger, a ticket strip or a sticker sheet, but the list stays findable.

## 4. Write each direction

One file per direction: `.aidw/design/directions/<id>.md`, `<id>` in kebab-case after the world. Same front matter
and sections as the examples, with `status: candidate`:

- **Character**: one paragraph a designer can hold while deciding what the file does not cover. Name the world's
  materials and tools in it.
- **Palette**: tokens with light and dark values and a `use` each, named as in `tokens.yaml`. Both themes are always
  designed; the scene decides which one leads. Work out the contrast of every text token on the surfaces it sits on
  and write the ratio beside it: 4.5:1 for body text, 3:1 for large text and control boundaries. A token below that
  is changed now, not later.
- **Type**: a display face and a body face (a data face only when the product shows figures in columns), all OFL.
  Fetch each one now into every mock folder that uses it:
  `aidw mock font "<family>" --weights <w,w> --to .aidw/design/mock/<id>/fonts`. A family the command refuses (not
  OFL, not on Fontsource, no Vietnamese when the product is Vietnamese) is replaced by one of the same kind. Give
  the scale and where each face goes.
- **Space, shape, elevation**: the unit and rhythm, the radii, and how one surface sits above another in this world
  (ink outline, paper stack, glow of a screen), declared once.
- **App screens** and **Landing pages**: the treatment of each region of the structure from step 3.
- **Motion**: durations, easing and the one authored moment; what moves and why the world moves that way.
- **Images and marks**: what kind of picture belongs (photograph treated how, flat shapes, none) and what the mark
  looks like.
- **Slop Check exceptions**: rule ids from `aidw plugin-path library/vendor/impeccable/antipatterns.json` that this
  world earns, each with its reason. Only `slop` rules can be lifted; `quality` rules never are.
- **Adapting to a subject**: what may change and what may not.

Spend boldness in one place per direction and say where in the Character paragraph. Write values, not intentions:
"`#FF48B0`, the primary action fill" can be built; "a vibrant accent" cannot.

## 5. Check the three against each other

Fill this table in your reply:

| axis | direction A | direction B | direction C |
|---|---|---|---|
| world | | | |
| leading theme | | | |
| density | | | |
| display face kind (condensed, serif, rounded, slab, script, grotesque, ...) | | | |
| layout posture (ledger, board, poster, console, feed, ...) | | | |
| motion character | | | |

No two directions share a world. Two that share three or more of the other axes are too close: rewrite the one
that is weaker for this product.

## 6. Check each against the generic defaults

Generated interfaces cluster around a few looks: warm cream with a serif and a clay accent; near-black with one
acid accent; hairline broadsheet columns; identical rounded cards with a soft grey shadow; a purple-to-blue
gradient; an eyebrow label above every heading. A direction that lands on one of these must show that its world
demands it, in the Character paragraph; otherwise rewrite it. Then compare with the examples: every section filled
with values, a world you can name, an authored moment. A direction that is only a palette and a font is not a
direction.

## Done when

Three files exist, each with every section filled, contrast ratios written, fonts fetched, and exceptions limited to
`slop` rule ids. Reply with the three paths, the table of step 5, and one sentence per direction on why its world
fits this product.

## Stop and report when

- The research note is missing, or fewer than three worlds pass step 2 and you cannot add one that does.
- A face the direction depends on has no OFL replacement of the same kind.
- The requirements do not say what the main screen is for.

## Sources

Ideas, not wording: Hallmark (nutlope/hallmark, MIT): a theme as material separate from the page's anatomy,
dealing several options and testing against a neighbouring prompt, and rejecting builds that share too many
structural axes. Anthropic `frontend-design`: grounding every choice in the subject's world and the list of
generated-look clusters. Impeccable: picking light or dark from the scene, and its catalog of `slop` rules as the
only liftable exceptions. The Direction Library's accepted examples: the format.
