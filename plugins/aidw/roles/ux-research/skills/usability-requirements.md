---
name: usability-requirements
description: Write usability and accessibility requirements that a reviewer can check on a screenshot or by reading the code, from the journeys.
---

# Usability requirements

"The app must be easy to use" cannot be reviewed. A usability requirement names a user kind, a task and something
a reviewer can see or count.

## Shape

> For <user kind> doing <task from the journey>, <what must be true>, checked by <what the reviewer looks at>.

- "For a first-time patient booking a slot, the next step is the only primary action on each screen; checked on
  the booking screenshots."
- "For clinic staff on a phone, cancelling an appointment takes at most three taps from the day view; checked by
  following the flow in the e2e test."
- "For any user, an error says what went wrong and what to do, next to the field it is about; checked on the
  error-state screenshots."

## Where they come from

Go through each journey stage and ask:

1. **Finding**: can the user see where to start and what is next? (one primary action; labels in their words)
2. **Deciding**: is what they need to decide in front of them at that moment? (the price before the button)
3. **Doing**: how many steps, how much typing, what is prefilled, what is remembered?
4. **Going wrong**: for each failure the journey lists: is it prevented, and if not, what does the user see and
   how do they recover? Is their input kept?
5. **Waiting and ending**: do they know it is working, that it worked, and what happens next?
6. **Coming back**: can they find what they did, change it, undo it?

Keep the ones that matter for this Change: usually five to ten, not fifty.

## Accessibility is not optional

State the level once (WCAG 2.2 AA unless the client requires another) and add the specific requirements this
Change makes relevant, each checkable:

- every action works from the keyboard, with a visible focus indicator, in a sensible order;
- text contrast at least 4.5:1, and 3:1 for large text and for the edges of controls;
- every control has an accessible name; every field has a visible label; an error is tied to its field;
- tap targets at least 24 by 24 CSS pixels; nothing depends on hover, on color alone or on dragging alone;
- content reflows at 320 CSS pixels wide without horizontal scrolling; text can be enlarged to 200%;
- motion can be reduced; nothing times out without a warning and a way to extend.

A user kind with a stated need (a screen-reader user, a one-handed user) gets requirements written from it.

## Where they go

In `changes/<id>/journeys.md` under `## Usability requirements`, numbered `U1`, `U2`... The Business Analyst turns
those that are behavior into scenarios; the designer and the `ui-ux` review check the rest. Mark each as
`scenario` or `review` so nothing is lost between the two.

## Sources

Ideas, not wording: Nielsen's ten usability heuristics, WCAG 2.2 (level AA success criteria), the GOV.UK Design
System and Service Manual guidance on forms and errors, and ISO 9241-11 (effectiveness, efficiency, satisfaction
in a context of use).
