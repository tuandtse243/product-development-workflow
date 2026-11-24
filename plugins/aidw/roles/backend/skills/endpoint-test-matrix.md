---
name: endpoint-test-matrix
description: Turn a route's contract into one test per outcome (success, each refusal, no caller, wrong permission, someone else's record, not found, conflict, too many) before writing the handler, and keep the handler thin.
---

# One test per outcome of a route

Serves rules B1, B2, B4, B5 and B6. A route that passes its happy-path test can still hand one user's record to
another, accept a field it should refuse, or return everything at once. Each of those is an outcome the contract
already names. Write them down as a matrix first, then let the tests drive the handler.

## Steps

1. **List the outcomes from the contract**, one row each. The usual rows for a route:

   | Row | Request | Expect |
   |---|---|---|
   | success | valid input, the owner | the contract's status and response shape, nothing more |
   | malformed input | unparseable body, wrong type, an unknown field | the contract's `400` and error shape |
   | invalid input | well formed but breaks a rule the contract states, one row per rule | the contract's `422` and error shape |
   | no identity | no session or token | `401` |
   | wrong role or permission | signed in, but not allowed this action (leave out when the route has no role check) | `403` |
   | another caller's record | a valid id that belongs to someone else | the contract's status for it (often `404`, so ids cannot be probed) |
   | not found | an id that does not exist | `404` |
   | conflict | the state the contract says is refused (duplicate, stale version) | `409` or the contract's status |
   | too many | a list beyond its maximum, a body beyond its size limit | the contract's limit behaviour |

   The statuses above are those of `aidw/api-design-rules`; the contract in the brief wins. Close calls are settled
   in `aidw plugin-path roles/backend/references/status-codes.md`. Leave out a row only when it cannot happen for
   this route (a public list has no "another caller's record").
2. **Name the scenario for each row.** Use the scenario id from the brief in the test name. A row the contract
   implies but does not answer (no status for "another caller's record", say) is a hole: ask the contract's author
   (Consultation), do not guess a status. A row you are sure is needed but out of the task's scope goes in your report.
3. **Write the tests through the real entry point**: the HTTP route or the action, with the real validation, the
   real authorization and the real error mapping. Replace only what crosses the process boundary (an outside
   service, the clock). A test that calls the service function directly does not prove the route.
4. **Watch each new test fail for the reason in its row** before you write the code: a `404` test that fails with
   a `500` from a missing table is not yet testing ownership.
5. **Keep the handler thin**: read and validate input, establish the caller, call one function that does the
   work, build the response from an explicit response shape, map known errors to the contract's statuses. Business
   rules live in that one function, where they are tested once.
6. **Assert the whole response, not one field**: the status, the shape, and that no field outside the contract is
   present (an internal id, a password hash, a stack trace).
7. **Check before you reply**: every row has a test, every test names its scenario, every status in your code is
   one the contract names. If the Role's `route-inventory` script is available, run it and compare.

## Right and wrong

For `PATCH /notes/{id}` (owner may edit the title; contract: `200`, `400` malformed, `422` invalid, `401`, `404` for
missing or not yours; no roles):

Right: one test per row through the route, each named after its scenario.

```
notes/edit/owner-edits-title          PATCH as owner, {title}         -> 200, body has exactly id,title,updatedAt
notes/edit/unknown-field-refused      PATCH as owner, {title,ownerId} -> 400, ownerId unchanged in the database
notes/edit/title-too-long             PATCH as owner, 201-char title  -> 422 problem body, field "title"
notes/edit/needs-sign-in              PATCH, no session               -> 401
notes/edit/not-yours                  PATCH as user B on A's note     -> 404, A's note unchanged
notes/edit/missing                    PATCH as owner, unknown id      -> 404
```

Wrong: one test against the service, a status the contract never named, and the ownership row missing.

```
it("updates a note", () => updateNote(noteId, { title: "x" }))   // no route, no caller, no validation
if (note.ownerId !== user.id) return res.status(403)              // contract says 404; 403 tells B the id exists
```

## Sources

Ideas, not wording: the OWASP API Security Top 10 (2023) items on object-level authorization, property-level
authorization, function-level authorization and unrestricted resource consumption (API1, API3, API4, API5); the
"watch it fail for the right reason" discipline of obra/superpowers `test-driven-development`; the checklist
headings of VoltAgent's `backend-developer` agent. Look there again when OWASP publishes a new edition.
