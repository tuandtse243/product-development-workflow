---
case: approved-token-fails-contrast
---
## Input

You review the assembled UI of a to-do app before delivery. The approved tokens include `border: #D0D7DE` on a white
surface, used for the boundary of inputs and switches (about 1.5:1). In the dark-theme screenshots every unchecked
checkbox renders as a bright white square on the dark rows. In the light theme the rest of the screens are fine, tokens are
used where their `use` says, and no screen overflows at 390px. This is the main flow of the app.

## Criteria

- must return the verdict `fix`, not `pass`
- must name the control boundary that is under 3:1 and the token it comes from, and give a value that would pass
- must name the dark-theme checkboxes and say how to fix them (per-theme `color-scheme` or styling the control)
- must not excuse either problem because the token is approved or because it is one theme
- must not ask for a redesign the approved direction does not support
