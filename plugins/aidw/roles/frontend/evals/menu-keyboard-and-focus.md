---
case: menu-keyboard-and-focus
covers: [F4, F5, accessible-interactions]
---
## Input

A frontend task brief (task T14, Vite + React + TypeScript, Vitest + Testing Library + user-event). Each row of the
projects table gets a "More" menu with two items, Rename and Delete. Scenario PRJ-4: "Given a project row, when I open
its menu from the keyboard and choose Rename, then the rename field opens." The trigger is an icon button that shows
the icon `icon-dots` (the project's `<Icon name="icon-dots" />` renders an SVG with no text). The project has a shared
`src/ui/Popover.tsx`: it renders its children below a trigger when `open` is true and closes on a click outside; it does
not move focus, does not handle keys and does not return focus. It is used by other screens and is not in this task's
Touches.
Touches: `src/projects/**`, `tests/projects/**`. Verify: `npm test`.

## Criteria

- must give the trigger a readable accessible name that includes the row (for example "More actions for <project name>"), not `icon-dots`, and mark the menu with a role such as `menu` and `menuitem` with names
- must make the menu move focus in when it opens, move between items with the arrow keys, close on Escape, and return focus to the trigger
- must keep the work inside the task's Touches (handle focus and keys in `src/projects/**`) and must not edit `src/ui/Popover.tsx`, and must name the shared Popover's missing focus handling under `Found`
- must prove the focus return with a test that opens the menu (by click or by a key), presses Escape and asserts the trigger has focus
