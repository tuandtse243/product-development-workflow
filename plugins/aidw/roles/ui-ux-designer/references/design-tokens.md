# Design tokens and tokens.yaml

`/aidw:start` step 5 writes `.aidw/design/tokens.yaml` whenever the plan has UI work. It is the
machine-readable half of the design: approved at the gate, frozen with `design/**`, and used after approval in
three places:

- **Briefs**: every UI task's implement and review brief carries the token table.
- **Checkpoint**: for UI tasks, every `color` and `font` token value must exist in the code. Color literals in
  the changed files that are not tokens are listed for the reviewer. At least one fresh screenshot is required.
- **Review**: the reviewer opens the screenshots and checks each token's `use` rule.

## Schema

```yaml
tokens:
  - name: accent             # kebab-case, unique
    kind: color              # color | font | size | space | radius | shadow | motion | other
    value: "#E5533D"         # colors: hex, rgb(), hsl(), oklch(); compared in canonical form (#e5533d == rgb(229, 83, 61))
    dark: "#FF7A66"          # optional dark-theme value (also checked in code and screenshots)
    use: Focus mode label, the Start button and the progress ring
    why: the one warm color, so the running timer is found at a glance   # optional; shown to implementers and reviewers
  - name: surface
    kind: color
    value: "#FAF5EC"
    dark: "#1C1816"
    use: page background
  - name: body
    kind: font
    value: Inter, system-ui, sans-serif   # the first family must appear in the code
    use: all text except the timer digits
  - name: radius-card
    kind: radius
    value: 12px
    use: cards and the to-do input
```

## Writing good `use` rules

Add `why` to a token whose value carries a decision (the accent, a type scale step, a spacing unit): an implementer who
knows the reason picks the right token for a case the `use` rule did not foresee, and a reviewer can judge a deviation.
Leave it out where the reason is obvious.

The `use` rule is what a reviewer compares with a screenshot, so it names visible things: "primary buttons and
the selected slot", not "brand color". Cover every color a user will notice: background, text, primary action,
mode or status colors, borders, error and success. A token that nobody can point to on a screen is noise; leave it out.

## Where tokens come from, by mode

| Mode | Source of the tokens |
|---|---|
| `existing` | Figma: `get_variable_defs` on the main frames (Figma MCP); a brand guide; or the live site's CSS custom properties. Copy values exactly. |
| `claude_design` | The exported bundle under `.aidw/design/`: its CSS custom properties / Tailwind theme. |
| `ai_design` | You author them in `direction.md` (personality, typography, spacing, layouts) and list them here. Check contrast: body text on surface at least 4.5:1. |
| `hybrid` | Tokens from the references where they exist, authored ones for the rest; say which in `direction.md`. |

## Showing a direction (ai_design, hybrid)

The user chooses a look by seeing it. On the design Decision Page each direction is one option, and its `html` slot
holds a small static mock of the product's main screen, drawn with that direction's own values:

- One screen, about 320 by 220 px: the surface, a heading and a line of body text in the direction's fonts (a system
  fallback stack, since nothing loads from the network), the primary action, one card or list row, one status color.
- Inline styles or one `<style>` block; the fragment is isolated, so set its own background and text color. No
  script, no external images or fonts.
- Under the mock, the palette as a row of swatches with their token names.
- The option's `criteria` say what the look trades: density (how much fits on a screen), tone (calm, playful,
  formal), contrast, effort to build.

At the Approval Gate the design section of the gate page repeats the chosen direction: the swatches with name, value
and `use`, and the type samples.

## In the code

The scaffold task (usually T01) puts the tokens into the code once, e.g. CSS custom properties in
`app/globals.css` mapped into the Tailwind theme. Every later UI task uses them. A color literal that is not a
token needs a reason in the review, or becomes a token (which changes the approved design: escalate).
