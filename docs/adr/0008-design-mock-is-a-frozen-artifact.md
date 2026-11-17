# The approved Design Mock is a frozen Artifact, dealt from a Direction Library and built by separate Agents

Status: accepted (2026-11-18)

The interfaces of the demo products were generic. The cause sat before any code: in `ai_design` the user chose a
look from three mocks of about 320 by 220 px in system fonts, the main session wrote the direction with no design
Skill, only colors and fonts were frozen as tokens, and the implementing Roles may not step outside what was
approved. A design Skill loaded at build time cannot repair a direction that was bland when it was approved. So
the design stage changes:

- The candidates come from a **Direction Library**: Design Directions written by aidw and accepted one by one by
  the factory's owner. Three are dealt for a product, and a record kept outside the project stops the next
  product from being dealt the same ones.
- Each candidate is a **Design Mock** of the main screen at real size: static HTML and CSS with its fonts and
  images beside it, built by its own `ui-ux-designer` Agent in a fresh context that sees one direction only.
- The chosen mock is extended to at most three screens (the main screen, one secondary screen such as a form,
  and a landing page when the product has one) and becomes an Artifact, frozen at the Approval Gate with the
  tokens, which are read from its CSS. Its images and their credits are frozen with it.
- After approval the mock binds structure and treatment (layout regions, density, type hierarchy, component
  treatment) for the screens it shows; a visible departure is a `fix`. Other screens follow the rules of
  `direction.md`. Nothing is compared pixel by pixel.
- References adjust the dealt directions and do not replace them. The `research` Role finds live sites of the
  same kind of product when the `ui-ux-designer` asks for it, and only traits shared by at least three of them
  are used. A reference is followed closely only when the user names it, and then its layout, color, type and
  spacing are followed while its name, mark, words, images and licensed fonts are replaced by the product's own.

A Design Mock is not a Decision Page (ADR-0007): the page stays a throwaway view and shows a thumbnail of each
mock with a link to the file.

## Considered Options

- **Keep freezing tokens only, and add a design Skill for the frontend Roles.** Rejected: the layout and detail
  the user liked are lost at the first task, and a palette alone produces the same three centered cards.
- **Let the model propose three directions from the subject.** Rejected: proposals converge on a few familiar
  looks, and two products come out alike. Dealing from a library with a record is the mechanism the two
  best-scoring public design skills share.
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
- aidw writes outside the project for the first time (the record of dealt directions). When that place cannot be
  written, directions are dealt at random.
- The library decides the taste of every product, so every direction in it is accepted by the owner first. It
  holds three (amended 2026-11-18): every product is dealt all three, and a new direction is added only when the
  owner asks. The mechanism is proven on one demo product judged on before-and-after screenshots.
- `anthropic/frontend-design` moves from the frontend Roles to the Agents that build mocks; a frontend Agent is
  told to build to the mock, not to choose a direction.
- The modes `existing`, `claude_design` and `hybrid` are unchanged.
