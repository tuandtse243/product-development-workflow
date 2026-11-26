---
name: world-scan
description: Find the worlds outside software a product's Design Directions can borrow from, each with concrete traits and cited pictures, plus the conventions of the kind of product - in a fixed note.
---

# World scan

The `ui-ux-designer` composes three Design Directions from your note, each borrowing one whole world: a place, a
trade or a printed thing with its own materials, tools and conventions (a night-shift console, a sticker sheet, a
risograph run). It cannot use the web. What you do not bring, it will make up from habit, and habit is what makes
two products look alike.

## 1. The subject

From the request and the requirements write: what the product is about in its users' words, who uses it, and where
and when (the room, the device, the light). Worlds come from these three, not from the category: "a to-do app" leads
nowhere; "the morning crew of a bakery planning the day's batches" leads to flour sacks, oven timers, chalkboards and
order slips.

## 2. Look for worlds, widest first

Run `aidw plugin-path roles/research/references/sources.md` and read the file it prints. Its search budget holds
for each world and for the conventions; its ladder holds for every trait you state as fact: the museum or archive
record and the trade's own documents come first, an enthusiast's blog is a lead. Collect six to eight candidates
from four directions:

- **The subject's own world**: the trade, its tools, its documents, its signs and packaging.
- **The users' surroundings**: where they are when they use it; what they read and handle there.
- **Printed and made things** with a strong convention: tickets, timetables, field guides, seed packets, ledgers,
  manuals, records sleeves, museum labels, maps, uniforms.
- **One lateral world**: something that shares a quality with the product (urgency, care, play, precision) but not
  its trade.

Drop a candidate you cannot describe beyond adjectives, and one any product of the same kind would get.

## 3. Record each world

For each, under its own heading:

- **Why it fits**: one sentence tying it to the subject, the people or the scene.
- **Traits**: at least three concrete ones: a material, a tool or object, a convention (how it numbers, labels,
  folds, stamps), with colors named the way that world names them, and the kind of lettering it uses.
- **Sources for the traits**: for each trait that is not plain from a picture, the source's words (at most two
  sentences) and its link to the section, with the tier.
- **Pictures**: two to four you opened, each with title, URL, author when known, and licence. Prefer Wikimedia
  Commons, Openverse and museum open-access collections (The Met, Rijksmuseum, Smithsonian), where the licence is
  stated. A picture with no stated licence is listed as reference only.
- **Cliché to avoid**: the first thing everyone does with this world.

## 4. The conventions of the kind of product

Open three to five live products of the same kind, on their own sites. Record only what at least three share: the
regions of the main screen, the density, the screens every one has, the words users expect for the main actions.
These set the structure, not the look: say nothing about their colors or fonts.

## 5. The note: `.aidw/research/worlds.md`

`## Subject` (the three lines of step 1), `## Worlds` (step 3, best fit first), `## Conventions` (step 4, each trait
with the products that share it), `## Not found` (what you looked for and where). Every URL is one you opened; never
cite a search snippet.

You bring material. You do not choose the three worlds or write a direction: the `ui-ux-designer` does.

## Sources

Ideas, not wording: Anthropic `frontend-design` (distinctive choices come from the subject's materials, instruments
and vernacular), Hallmark (nutlope/hallmark, MIT: a theme as a material, a credited library of openly licensed
photographs), and this Role's own `evidence-scan` and `sources.md` for citing what was opened.
