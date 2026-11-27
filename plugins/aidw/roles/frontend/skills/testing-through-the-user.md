---
name: testing-through-the-user
description: Write component and page tests the way a user meets the screen - find controls by role and name, act with user-event, wait with findBy, fake the network at its boundary (MSW or the project's fetch fake) - and assert what is visible, never component state or a mocked child.
---

# Test through the user's view

Serves rules F6, F3 and F9. A test that clicks `.slot` with `querySelector` and reads `state.open` passes on a screen
no one can use: the button may have no name, the dialog may never render. A test that finds the button by its name and
waits for the dialog by its title fails exactly when the user would. That is what the scenario's WHEN asks for, and
what the reviewer checks.

## Steps

1. **Render the real component or route**, with the project's providers (router, query client, theme) through its test
   helper when one exists. Render the screen, not the hook alone: a scenario whose WHEN is a click needs the control.
2. **Query in this order**, and move down only when the one above cannot find it:
   `getByRole(role, { name })` (buttons, links, headings, dialogs, fields), `getByLabelText` (form fields),
   `getByPlaceholderText`, `getByText` (non-interactive text), `getByDisplayValue`, `getByAltText`, `getByTitle`, and
   `getByTestId` last. A control you cannot find by role and name is a finding against F4, not a reason for a test id.
3. **Act with `user-event`** (`const user = userEvent.setup()`, `await user.click(...)`, `await user.type(...)`,
   `await user.keyboard("{Escape}")`), not `fireEvent`: it sends the events a real click or key press sends, focus
   included.
4. **Wait for what appears with `findBy*`** and for what leaves with `waitForElementToBeRemoved`; use `queryBy*` only to
   assert absence. No fixed sleeps, and no `act` warning left in the output.
5. **Fake the network at its boundary, nowhere else.** Use the project's MSW handlers (`server.use(http.get(...))` for
   one test) or its fetch fake, answer with bodies shaped as the contract says, and let the real data layer, hooks and
   components run. Never `vi.mock` the hook or child component of the screen under test. For an out-of-order test,
   delay one answer (`await delay(300)`) and answer the other at once.
6. **Assert what the user sees**: text, names, `toBeVisible()`, `toHaveFocus()`, `toBeDisabled()`,
   `toHaveAttribute("aria-invalid", "true")`, and for a write, the request the handler received. Never assert component
   state, instance methods, class names, or a snapshot of a whole tree.
7. **Name each test after its scenario id**, as `implement-a-task` says. When the project's existing tests use
   `querySelector` or test ids, write yours by role anyway and say in the report why yours differ.

## Right and wrong

Scenario `booking/book-slot/confirm-opens`: when I click a slot, a confirm dialog opens.

Right: found by role and name, clicked with user-event, the dialog awaited by its name.

```
server.use(http.get("/api/slots", () => HttpResponse.json({ slots: [{ id: "s1", start: "09:00" }] })));
render(<BookingPage day="2026-12-03" />);
const user = userEvent.setup();
await user.click(await screen.findByRole("button", { name: /09:00/ }));
expect(await screen.findByRole("dialog", { name: /confirm/i })).toBeVisible();
```

Wrong: a CSS selector, a synthetic click, a state assertion, and the screen's own hook mocked away.

```
vi.mock("./useSlots", () => ({ useSlots: () => ({ data: [{ id: "s1" }] }) }));   // the data layer never runs
container.querySelector(".slot")!.click();
expect(wrapper.state("open")).toBe(true);                                       // no user sees state
```

## Sources

Ideas, not wording: Testing Library's "About Queries" page, the priority section (testing-library-docs, MIT); the
`user-event` documentation (MIT); Mock Service Worker's documentation for `msw/node` and per-test handlers (MIT);
aidw's `task-review` pass 1 (the test drives the WHEN through the real entry point). Look there again when Testing
Library or MSW ships a new major version.
