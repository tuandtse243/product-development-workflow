---
name: accessible-interactions
description: Build overlays (dialog, menu, popover, drawer), composite widgets (tabs, combobox, listbox, disclosure) and icon-only controls with a readable name, the right role and the pattern's keyboard table - focus in, Tab kept inside, Escape, focus back - and prove each with a test.
---

# Names, roles and focus for what axe cannot judge

Serves rules F4 and F5. An axe scan passes a dialog that leaves focus on the page behind it, and a button named
"icon-dots". Those are what a keyboard or screen reader user meets first, and the qa `a11y` layer only sees them at the
end of the Change. Get them right in the task, and leave a test that fails when they break.

## Steps

1. **Use the platform or the project's primitive first.** A `<button>` for an action, `<a href>` for navigation,
   native `<select>`, `<details>`, `<dialog>`; or the project's existing Dialog, Menu or Popover component. Hand-roll a
   widget only when neither exists. A `div` with `onClick` needs a role, `tabIndex={0}` and Enter and Space handling,
   which is why it is the last choice.
2. **Name every control from the user's words.** Visible text names it; an icon-only control gets `aria-label` with
   the action and its object ("More actions for Invoice 42", "Close"), never the icon's key or file name. A field gets a
   `<label>` bound by `htmlFor`/`id` or wrapping it. A meaningful image gets `alt` that says what it shows; a decorative
   one `alt=""`.
3. **Follow the pattern's keyboard table.**

   | Pattern | Opens with | Inside | Closes with | Focus after closing |
   |---|---|---|---|---|
   | modal dialog | the trigger | Tab and Shift+Tab cycle inside; the page behind is inert | Escape, the close button | the trigger |
   | menu button | Enter, Space, Arrow Down on the trigger | Arrow keys move between items, Home and End, Enter picks | Escape, a pick, Tab | the trigger |
   | popover (not modal) | the trigger | Tab leaves it | Escape, a click outside | the trigger on Escape |
   | combobox | typing in the input; Arrow Down opens the list | focus stays in the input and `aria-activedescendant` names the active option; Arrow Up and Down move it, Home and End go to the ends | Enter selects the active option; Escape closes the list, a second Escape clears the input | the input |
   | listbox | Tab onto it (or Arrow keys on its trigger) | Arrow Up and Down move the active option (`aria-activedescendant` or roving focus), Home and End jump, typing a letter jumps to a match | Enter or Space selects; Escape closes a popup listbox | the trigger |
   | tabs | - | Arrow keys move between tabs, Tab goes into the panel | - | - |
   | disclosure | Enter, Space | - | Enter, Space | stays on the trigger, `aria-expanded` changes |

   Name the dialog (`aria-labelledby` its title) and give the trigger `aria-haspopup` and `aria-expanded` when it
   opens a menu.
4. **Keep the focus ring.** Never remove `outline` without a `:focus-visible` style made from the tokens (the accent
   token's **Use** usually names the focus ring).
5. **Test it with the keyboard and focus assertions**: open with the user's action, assert focus is inside
   (`expect(dialog).toContainElement(document.activeElement)`), press Escape, assert `expect(trigger).toHaveFocus()`.
   For a menu, press Arrow Down and assert the next item has focus.
6. **A shared primitive that breaks a row of the table** (a Popover that does not return focus): fix it when its file is
   in Touches; otherwise wrap it in your component so your screen is right, and name the primitive under `Found` in the
   report. Do not copy its defect into new code. When the design leaves a control's look open (no focus style, no
   pressed state), ask `ui-ux-designer` as a Consultation and build the rest meanwhile.

The vendored Web Interface Guidelines list more checks (sections "Accessibility", "Focus States", "Touch &
Interaction"): `aidw plugin-path library/vendor/vercel/command.md`.

## Right and wrong

A row's "More" menu with an icon-only trigger:

Right: a named button, the menu's keyboard table, focus back on the trigger, and a test that says so.

```
<button aria-label={`More actions for ${row.name}`} aria-haspopup="menu" aria-expanded={open} ref={trigger}>
  <Icon name="icon-dots" aria-hidden="true" />
</button>
onClose = () => { setOpen(false); trigger.current?.focus(); }
test: click trigger -> menu by role "menu" has focus on "Rename"; ArrowDown -> "Delete" has focus;
      Escape -> menu gone, expect(trigger).toHaveFocus()
```

Wrong: a clickable `div` named by its icon key, and a menu that closes but leaves focus on `body`.

```
<div onClick={() => setOpen(true)}><Icon name="icon-dots" /></div>    // no role, no tab stop, name "icon-dots"
onKeyDown={(e) => e.key === "Escape" && setOpen(false)}                // focus is lost when the menu unmounts
.menu-item:focus { outline: none; }                                     // no visible focus at all
```

## Sources

Ideas, not wording: the WAI-ARIA Authoring Practices patterns for dialog, menu button, tabs, combobox and disclosure
(their keyboard tables); the vendored Web Interface Guidelines (`vercel/command.md`, MIT), sections Accessibility and
Focus States; Addy Osmani's `web-quality-skills` `accessibility` skill for the WCAG 2.2 items (focus not obscured,
target size); `eslint-plugin-jsx-a11y` for the list of name and role mistakes. Look there again when WCAG publishes a
new version.
