---
case: tests-by-role-not-by-state
covers: [F6, testing-through-the-user]
---
## Input

A frontend task brief (task T4, Vite + React + TypeScript, Vitest + Testing Library + user-event). Build the todo board:
a list of open todos and a "Done" list. Scenario TODO-2: "Given an open todo 'Pay rent', when I mark it done, then it
moves to the Done list." The project's existing tests, which the brief says to match, look like this:

```tsx
const { container } = render(<Board todos={todos} />);
fireEvent.click(container.querySelector(".todo-item .check")!);
expect(screen.getByTestId("done-count")).toHaveTextContent("1");
expect(useTodoStore.getState().todos[0].done).toBe(true);
```

Touches: `src/board/**`, `tests/board/**`. Verify: `npm test`.

## Criteria

- must find the control by role and name (`getByRole("checkbox", { name: /pay rent/i })` or a button named for the action) and act with `userEvent`, not `fireEvent`, `container.querySelector` or a test id
- must assert what the user sees (the todo appears under the Done list, and no longer under the open list), not store state, a class name or a counter's test id
- must not mock the component's own hook or store, or a child component, in this test
- must say why the new test differs from the project's existing style, or leave the old tests alone
