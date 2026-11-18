# The approved Design Mock is a frozen Artifact, composed from researched worlds and built by separate Agents

Status: accepted (2026-11-18)

The interfaces of the demo products were generic. The cause sat before any code: in `ai_design` the user chose a
look from three mocks of about 320 by 220 px in system fonts, the main session wrote the direction with no design
Skill, only colors and fonts were frozen as tokens, and the implementing Roles may not step outside what was
approved. A design Skill loaded at build time cannot repair a direction that was bland when it was approved. So
the design stage changes:

- The candidates are composed for each product (amended 2026-11-18). The `research` Role brings sources the
  `ui-ux-designer` asks for: worlds outside software that fit the product's subject and users (print, signage,
  packaging, editorial, instruments, maps, ...) and, only for the conventions of the kind of product, live sites
  of the same kind. The `ui-ux-designer` composes three Design Directions from them in one context, each
  borrowing one whole world and no two sharing a world. A world may come back for another product or in
  another round. The **Direction Library** holds the examples the owner accepted, which set
  the format and the bar, not the candidates.
- Each candidate is a **Design Mock** of the main screen at real size: static HTML and CSS with its fonts and
  images beside it, built by its own `ui-ux-designer` Agent in a fresh context that sees one direction only.
- The chosen mock is extended to at most three screens (the main screen, one secondary screen such as a form,
  and a landing page when the product has one) and becomes an Artifact, frozen at the Approval Gate with the
  tokens, which are read from its CSS. Its images and their credits are frozen with it.
- After approval the mock binds structure and treatment (layout regions, density, type hierarchy, component
  treatment) for the screens it shows; a visible departure is a `fix`. Other screens follow the rules of
  `direction.md`. Nothing is compared pixel by pixel.
- Live sites of the same kind of product give its conventions and do not set the look. The `research` Role finds
  them when the `ui-ux-designer` asks for it, and only traits shared by at least three of them are used. A reference is followed closely only when the user names it, and then its layout, color, type and
  spacing are followed while its name, mark, words, images and licensed fonts are replaced by the product's own.

A Design Mock is not a Decision Page (ADR-0007): the page stays a throwaway view and shows a thumbnail of each
mock with a link to the file.

## Considered Options

- **Keep freezing tokens only, and add a design Skill for the frontend Roles.** Rejected: the layout and detail
  the user liked are lost at the first task, and a palette alone produces the same three centered cards.
- **Let the model propose three directions from the subject alone.** Rejected: proposals converge on a few
  familiar looks, and two products come out alike. Composing from worlds researched for each product keeps the
  variety of a library without its limit.
- **Deal from a fixed library of directions the owner accepted.** First chosen, then dropped (2026-11-18): with
  three directions every product is dealt the same three, and two products of the same kind come out alike.
  Dealing from a library with a record is what the two best-scoring public design skills do; it needs a library
  far larger than the owner can review.
- **One context builds the three mocks in turn.** Rejected: the second and third drift toward the first.
- **Mocks made by an image or design tool (Stitch, Figma).** Rejected as the default: it needs an account, exact
  tokens cannot be read from a picture, and the frontend Role would have only an image to look at.
- **Vendor Hallmark or Impeccable whole.** Rejected (ADR-0005): each brings its own flow, scripts and hooks, which
  would run beside the Decision Page, the Role and the Gate that already do that work. Their methods are used in
  an Authored Skill; Impeccable's rule catalog and craft floor are vendored as lookup material.
- **Compare screenshots with the mock by pixel.** Rejected: real data makes every screen differ.

## Consequences

- The design stage costs more: three Agents of the deep Tier where one session wrote a file. The size of that
  cost has not been measured.
- No record of the worlds used is kept: a world may come back for another product or in another round, and the
  variety comes from researching for each product. Only the three directions of one round must differ.
- The owner no longer accepts each direction before it is used; taste is judged when the user chooses among the
  mocks. The accepted examples are what keep the bar, so a composed direction must be as
  complete as an example. The mechanism is proven on one demo product judged on before-and-after screenshots.
- `anthropic/frontend-design` moves from the frontend Roles to the Agents that build mocks; a frontend Agent is
  told to build to the mock, not to choose a direction.
- The modes `existing`, `claude_design` and `hybrid` are unchanged.
