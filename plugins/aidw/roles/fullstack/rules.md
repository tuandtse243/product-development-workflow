Each rule is answered pass or fail on the diff of one task. A rule binds when its "applies when" holds; the reviewer
cites the id in a finding (`1. X1: web/ProjectList.tsx: ...`). A rule whose right action is to ask is kept when you asked
(a Consultation, see "Ask before you guess"); guessing breaks it. These rules cover only the seam between the two halves
of one Slice; each half is judged by its own table.

| id | rule | applies when | checked by |
|---|---|---|---|
| X1 | Each scenario whose WHEN is a user action has at least one test that crosses the seam in process: it drives the client (the rendered screen, or the client's request function) and the real server handler answers, with only outside services and the clock faked; where the stack cannot render the screen in a test (an async Server Component), a contract test runs the same shape against both halves. | the task builds both a server half and a client half of one scenario | reviewer |
| X2 | A request or response shape that the client and the server both use is written once (a shared schema or type with a runtime check) and imported by both, or pinned by a contract test both halves run; the shared module imports nothing server-only, so a client file can import it (F10). | the task adds or changes a shape both halves use | reviewer |
| X3 | Data the server half hands to client code without a route (Server Component props to a client component, a `load` return, a page payload, a server action's return) is built from an explicit shape that names its fields, never a row, an entity or a whole user object (B5 for the seam). | the server half passes data to client code | reviewer |
| X4 | A loader, page or Server Component that reads a record a user may not see checks access on the server before it reads (B2 and B3 for pages) and has the three access tests or the stack's equivalent; a client redirect is the convenience F11 allows, never the check. | the task adds or changes server code that renders a restricted page or reads a user-owned record for one | reviewer |
| X5 | When your Touches hold the server half, the inherited "ask `api-designer`" in F11 and F14 means: close it in your half (the access check, the computed field) when the contract names it; ask `api-designer` only for what the contract does not name (B1, F1); a hole in server code outside your Touches goes under `Found`. | the task holds both halves and an F11 or F14 case arises | reviewer |
| X6 | Every error a scenario names reaches the user as the client state F3 or F9 asks for, proven once through the seam (X1's test or the contract test): the client reads the field the server's error body really carries. | the task adds or changes an error path a scenario names, on both halves | reviewer |
| X7 | After a write the screen shows what the server stored, not what was typed: it revalidates, invalidates the cached read or renders the response, and a test asserts a value the server changes (a trimmed name, a generated id, a new total). | the task adds or changes a write that a screen of the task shows | reviewer |

Owned elsewhere and not repeated here: the backend rules B1 to B15 (`aidw plugin-path roles/backend/rules.md`) and the
frontend rules F1 to F16 (`aidw plugin-path roles/frontend/rules.md`) bind through `follows_rules`, each on its own half
of the diff. Each X rule binds only when the task's Touches hold both a server half and a client half; a task with one
half is judged by that half's table alone. Test first with the scenario id, Touches, weakened checks, secrets in files
and added packages (`library/implement-a-task.md` and the checkpoint); schema and migrations (the `database` task, B15);
the glue of a split Slice (`integration`); React and Next.js habits (`aidw/react-rules` and the framework packs).
