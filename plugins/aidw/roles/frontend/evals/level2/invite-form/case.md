---
case: invite-form
covers: [F1, F4, F9, forms-from-the-contract, testing-through-the-user]
fixture: frontend-web
change: invite-a-person
task: T01
timeout_min: 35
max_turns: 90
screenshots: off
restore: [.aidw/design/tokens.yaml, tests/setup.ts, tests/environment.ts, tests/render.tsx, tests/msw/handlers.ts, tests/msw/server.ts]
must_read:
  - .aidw/changes/invite-a-person/api-contract.md
  - plugin:roles/frontend/skills/forms-from-the-contract.md
  - plugin:roles/frontend/skills/screen-states.md
---
## Situation

Task T01 of the fixture's Change `invite-a-person`: a form at `/people/invite` of a Vite + React 19 app, a name and an
email sent to `POST /api/invitations`. The contract names a `422` whose body carries `errors`, one entry per field at
fault, and says the name is 1 to 80 characters. The fixture has no browser (Vitest, jsdom, Testing Library, MSW), so
`screenshots: off` drops the brief's screenshot lines; the design tokens stay in it.

The sibling an Agent might copy is wrong: `src/contact/ContactPage.tsx` takes its fields by placeholder, has no label,
no check before sending and no guard against a second submit, and tells every outcome, an API refusal included, in one
toast under the form. `ApiError.body` (src/api/client.ts) holds the parsed problem body, which is where a `422`'s `errors`
are; the contract has no case for "already a member" (an `expect: ask` variant that would need a Consultation of
`api-designer` is possible future work; this case is the main one and asks nothing).

The held-out tests (`held-out/tests/held-out/invite-form.test.tsx`) render the app's router at `/people/invite` and use the
fixture's MSW handlers (restored before grading); the requests are counted from the MSW log: both fields are found by
`getByLabelText` and the button by its name; an empty name sends no request and its message is tied to the Name field with
`aria-describedby`; a name of 81 characters is never sent (refused with a message on the field, or not typeable, for
example through `maxLength`); a valid form sends exactly the two fields, says "Invitation sent" with the email and empties the
fields; a `422` for the email shows the API's message under the Email field, marks it `aria-invalid`, leaves the Name
field unmarked and keeps both values; a double click sends one `POST`; a `503` is an alert, keeps the values and leaves
the form sendable. The checks run the Role's `a11y-names` (no `no-label`, `no-name` or `div-click` in the added code) and
`token-literals` (the tokens file is restored before grading), that every scenario id names a test, the whole suite, the
typecheck, and that nothing outside Touches changed (only `src/team/`, `tests/team/`, `src/routes.tsx` and the run and
change folders of `.aidw/`). A model grades only what the Agent says about the contact form.

## Criteria

- must say, in its final reply, its report file, or the Progress note of a Consultation request it wrote, that the existing contact form (src/contact/ContactPage.tsx) has a defect (it shows every error in one toast, takes its fields by placeholder only, or can be submitted twice), as a problem outside Touches for someone else to fix, instead of copying that pattern or keeping quiet about it
