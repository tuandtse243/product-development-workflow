---
name: ui-review-rubric
description: What to look for in the screenshots and the code of an assembled UI, in order of how much it hurts the user.
---

# UI review rubric

Go through the screens in the order a user meets them. For each, work down this list and stop adding remarks once
you have the blocking ones: three problems that matter beat thirty that do not.

## 1. Can the user do the job (blocking when not)

- The primary action of each screen is the most prominent thing on it, and there is only one.
- Every state exists and was designed: empty (with what to do next), loading, error (what went wrong, what to do),
  partial, success, and the long-content and many-items cases. A spinner forever or a blank area is a `fix`.
- Destructive actions ask or can be undone. A form keeps what was typed when it fails, and says which field.
- It works at the phone width and at desktop: nothing cut off, no horizontal scroll, targets big enough to tap.

## 2. Does it match the approved design (blocking when visibly not)

- Each token is used where its `use` says, and no color or font appears that is not a token.
- Spacing follows one scale; the same kind of thing looks the same everywhere (buttons, inputs, cards, headings).
- Dark values are applied when the design has them; nothing is unreadable in either theme.

## 3. Can everyone use it (blocking on a main flow)

- Text contrast is at least 4.5:1 (3:1 for large text and for the boundary of a control).
- Everything works from the keyboard, in a sensible order, with a focus indicator you can see.
- Controls have accessible names; images that mean something have alt text; a form field has a label, not only a
  placeholder; an error is tied to its field and announced.
- Dialogs and menus trap focus, close on Escape and return focus to what opened them.
- Nothing depends on color alone, on hover alone, or on motion that cannot be turned off.

## 4. Does it look made by a person (non-blocking unless the direction is ignored)

Signs of a generic generated interface, each worth a remark when the design direction does not ask for it:

- everything centered, everything in a card, every card with the same shadow and radius;
- a purple-to-blue gradient, glassy panels, an icon in a tinted circle before every heading;
- more than two type sizes competing as "the heading"; body text in grey that is too light;
- decoration that carries no information: emoji as bullets, badges that say nothing, animations on load.

Say what the direction asked for and what the screen does instead.

## 5. Details that add up (non-blocking)

Alignment to a grid, text that wraps badly or truncates a name, numbers that jump because they are not tabular,
icons of mixed weight, dates and money in the wrong locale, a layout that shifts when data arrives.

## Writing the verdict

A blocking line names the screen (and screenshot), what the user cannot do or what differs from the design, and
the change that fixes it. Do not ask for a redesign the approved direction does not support.

## Sources

Ideas, not wording: the critique method of pbakaus/impeccable (including its list of generated-interface tells),
Vercel's Web Interface Guidelines, WCAG 2.2 at level AA, Nielsen's usability heuristics, and Addy Osmani's
accessibility checklist, which stays the vendored reference.
