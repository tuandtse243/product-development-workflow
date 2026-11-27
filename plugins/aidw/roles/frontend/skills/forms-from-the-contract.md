---
name: forms-from-the-contract
description: Build a form from the API contract - its constraints as one client schema no stricter than the server's, a label and the right input type for every field, the contract's field errors tied to their fields, values kept after a failure, one request per submit, focus on the first error.
---

# Forms from the contract

Serves rules F9 and F1. A form whose client checks differ from the server's either refuses what the server accepts (a
regex stricter than the contract) or lets through what it refuses and then shows "Something went wrong" for a `422`.
The contract already says which fields exist, their limits and the shape of a field error. Build the form from it.

## Steps

1. **Read the constraints from the contract** into one schema in the project's validator (zod, valibot, yup, or the
   form library's rules): required, length, format, allowed values, exactly as the contract states them. The client
   check is a convenience; the server's check still decides. A constraint the contract does not state (a maximum length,
   an allowed format) is a hole: ask `api-designer` as a Consultation and build the rest meanwhile, never a limit you
   picked.
2. **Label and type every field.** A `<label>` bound to the input, the right `type` (`email`, `url`, `tel`,
   `number`), `inputMode`, `autoComplete` (`email`, `name`, `new-password`), and `required` where the contract requires.
   The hint text the design shows goes in `aria-describedby`.
3. **Map the contract's error body to fields.** For `422 { errors: [{ field, message }] }`, set each field's error from
   its entry: `aria-invalid="true"` on the input and the message in an element the input names in `aria-describedby`.
   An error with no field, or a status the contract names without a field, goes in a form-level alert. An error the
   contract does not name gets the generic error state and no parsing of message strings.
4. **Keep what the user typed.** A failed submit, client or server, never clears the fields.
5. **One request per submit.** Disable the submit (or ignore it) while a request is pending, show that it is pending,
   and re-enable it on any answer.
6. **Move focus to the first field in error** after a refused submit, so a keyboard or screen reader user lands on it.
   Error wording says what to do ("Use 80 characters or fewer"), not what went wrong in the code; impeccable's
   `clarify.md` has the rules for it (`aidw plugin-path library/vendor/impeccable/clarify.md`), and the Forms section of
   `aidw plugin-path library/vendor/vercel/command.md` lists the input checks.
7. **Test the three paths**: one client refusal with no request sent (count requests in the network fake), one server
   field error shown under its field with `aria-invalid`, and a double click that sends one request.

## Right and wrong

A profile form; the contract: `displayName` string 1..80, required; `website` optional URL; `422` with
`errors: [{ field, message }]`.

Right: the contract's limits, the server's field error on its field, one request per submit.

```
schema: displayName: string().min(1).max(80, "Use 80 characters or fewer"); website: string().url().optional()
<label htmlFor="displayName">Display name</label>
<input id="displayName" autoComplete="name" aria-invalid={!!err.displayName} aria-describedby="displayName-error" />
<p id="displayName-error">{err.displayName}</p>
422 {errors:[{field:"website", message:"..."}]} -> website gets aria-invalid and the message; values stay
<button type="submit" disabled={pending}>Save</button>
tests: 81 characters -> refused, 0 requests; server 422 on website -> message under website; double click -> 1 PUT
```

Wrong: a stricter rule than the server's, and a field error shown as a toast that clears the form.

```
website: string().regex(/^https:\/\/[a-z]+\.com$/)     // refuses URLs the contract accepts
catch { toast("Something went wrong"); reset(); }      // the 422's field errors are lost, and so are the values
```

## Sources

Ideas, not wording: the vendored Web Interface Guidelines (`vercel/command.md`, MIT), section Forms; impeccable's
`clarify.md` for error wording (vendored, Apache-2.0); WCAG 2.2 success criteria 3.3.1 (error identification), 3.3.3
(error suggestion) and 3.3.7 (redundant entry), as summarised in Addy Osmani's `web-quality-skills` (MIT).
