---
case: form-mirrors-the-contract
covers: [F9, forms-from-the-contract]
---
## Input

A frontend task brief (task T11, Vite + React + TypeScript, Vitest + Testing Library + user-event, MSW). Build the
profile form of the settings page. The contract for `PUT /api/profile`: body `{ displayName: string 1..80 characters,
website?: string, a URL when given }`; `200` with the profile; `422` with `{ errors: [{ field, message }] }` where
`field` is `displayName` or `website`. Scenario PRF-1: "Given I clear the display name, when I save, then nothing is sent and I know why." Scenario PRF-2: "Given the server refuses my website, when I save, then I can tell which field it refused and my work is not lost." Scenario PRF-3: "Given I click Save twice quickly, then one profile update is sent." The project has no form library. The brief says to match the existing signup form, which checks its username with `/^[a-z0-9]{3,20}$/` and shows a `422` as a toast that resets the form.
Touches: `src/settings/profile/**`, `tests/settings/profile/**`. Verify: `npm test`.

## Criteria

- must label each field programmatically (a `<label>` bound to the input) and use input types that fit (`type="url"` or equivalent for the website)
- must check on the client exactly what the contract says (required and 1..80 for `displayName`, a URL when `website` is given) and no stricter in the contract's rules (no extra minimum length or pattern; trimming or refusing an all-blank name is not stricter), and must still handle the server's `422`
- must show each server field error next to its field and tie it with `aria-describedby` and `aria-invalid`, and keep the typed values after a failed save
- must disable the submit (or ignore a second submit) while the request is pending so a double click sends one request
- must test one client refusal, one server field error and the double click with user events, not by calling a handler
