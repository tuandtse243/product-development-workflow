---
name: screen-states
description: List every state a data-reading view can be in (loading, empty, each error, partial, success, long content, many items, pending write) from the scenarios and the contract, map each to a scenario id, write one test per row, then build - so a failed load never looks like an empty list.
---

# Every state of a screen, before the happy one

Serves rules F3 and F6. A screen that passes its success test can still go blank when the request fails, show "No
slots" when the server is down, or spin forever on an empty answer. Each of those is a state the scenarios and the
contract already imply. Write them down as a table first, then let the tests drive the component. This is the
frontend twin of the backend's `endpoint-test-matrix`.

## Steps

1. **List the states from the scenarios and the contract**, one row each. The usual rows for a view that reads data:

   | Row | What the network does | What the user sees |
   |---|---|---|
   | loading | the request is in flight | a placeholder that keeps the layout (skeleton or spinner with a label), no stale "empty" text |
   | empty | success with no items | a sentence that says what is empty and the next step ("No open slots on Tue 3 Dec" + "Pick another day") |
   | error, one row per error the contract names | `4xx`/`5xx` with the contract's error body, or a network failure | what failed, the way out (Retry, Back, Sign in), announced with `role="alert"` or a live region |
   | partial | some of the data arrived (a page, one of two reads failed) | what arrived, and a clear marker for what did not |
   | success | the normal answer | the data |
   | long content | a name of 80 characters, a 3-line address | no overflow, no clipped control label |
   | many items | more than one page | paging or "Load more" as the contract pages it |
   | pending write | a mutation in flight from this view | the control shows it is busy and cannot be pressed twice |

   Leave out a row only when it cannot happen for this view. The edge cases (long text, many items, offline, slow
   network) are spelled out in `aidw plugin-path library/vendor/impeccable/harden.md`, sections "Text Overflow &
   Wrapping", "Error Handling" and "Edge Cases & Boundary Conditions"; read the section a row needs.
2. **Name the scenario for each row.** Use the scenario id from the brief in the test name. A state the design does not
   draw (no error style, no empty illustration) is a hole in the design: build it with the token whose **Use** comes
   nearest and name the gap under `Owed` in the report. A state the contract does not answer (no error body for a
   `503`) is a hole in the contract: ask `api-designer` as a Consultation and build the other rows meanwhile.
3. **Keep error and empty apart in the code.** Branch on the request's status first (`loading`, `error`, `success`),
   and only inside success on the number of items. A condition on `data?.length` alone turns every failure into
   "empty".
4. **Write the tests through the rendered component**, with the network faked at its boundary (the project's MSW
   handlers or fetch fake), one per row: the empty text, the alert with its Retry, and that Retry sends the request
   again. The `testing-through-the-user` skill has the queries.
5. **Watch each new test fail for the reason in its row** before you build the branch it needs.
6. **Check before you reply**: every row has a test that names its scenario, no row renders nothing, and the error
   rows do not reuse the empty text.

## Right and wrong

A list of open slots read from `GET /api/slots?day=` (contract: `200 {slots: []}`, `503` problem body):

Right: one branch per status, the error distinct from the empty state, one test per row.

```
slots/list/loading       -> <SlotSkeleton aria-busy="true" />, no "No open slots" text
slots/list/empty         -> "No open slots on Tue 3 Dec" + <button>Pick another day</button>
slots/list/error-503     -> <div role="alert">Could not load slots. <button>Retry</button></div>; Retry refetches
slots/list/success       -> one <button> per slot, named by its time
slots/list/long-name     -> an 80-character doctor name wraps, the slot buttons keep their names
```

Wrong: a failure that shows nothing, or that shows "no slots".

```
{error ? null : <SlotList slots={data} />}                        // blank screen when the request fails
{data?.length ? <SlotList slots={data} /> : <Empty />}            // a 503 reads as "no open slots"
```

## Sources

Ideas, not wording: aidw's `ui-review-rubric` (every state designed, section 1); impeccable's `harden.md` (edge cases
and error handling, vendored under Apache-2.0); Addy Osmani's `frontend-ui-engineering` skill, "Meaningful Empty and
Error States" (vendored, MIT); the backend Role's `endpoint-test-matrix` for the one-row-per-outcome shape.
