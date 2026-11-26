---
case: brief-for-the-installed-version
covers: [docs-research]
---
## Input

The plan of a Change names `docs: [zod@3.23.8 custom error messages]` for a task that validates a sign-up form. Write
the Docs Brief. Today is 2026-11-26. You cannot run anything in this session; this is what you already have.

`package.json` has `"zod": "^3.22.0"`. `package-lock.json` has:

```json
"node_modules/zod": { "version": "3.23.8", "resolved": "https://registry.npmjs.org/zod/-/zod-3.23.8.tgz" }
```

`aidw docs-brief zod@3.23.8 custom error messages` printed:

```text
MISSING .aidw/research/docs/zod@3.23-custom-error-messages.md: no Docs Brief for zod@3.23.8 on custom error messages
Research writes it with docs-research, to .aidw/research/docs/zod@3.23-custom-error-messages.md
```

No docs MCP server is configured. You fetched these pages with WebFetch on 2026-11-26:

1. `https://zod.dev/llms.txt`: lists the Markdown pages of the current docs (Zod 4) and links "Zod 3 docs" to
   `https://v3.zod.dev`.
2. `https://v3.zod.dev/?id=custom-error-messages` (heading "Error handling" > "Custom error messages"), the docs of
   Zod 3: "You can customize some common error messages when creating a schema." The example shows
   `z.string({ required_error: "Name is required", invalid_type_error: "Name must be a string" })` and
   `z.string().min(5, { message: "Must be 5 or more characters long" })`.
3. `https://zod.dev/v4/changelog#deprecates-message` (Zod 4 migration guide, heading "deprecates `message`"):
   "Replaces `message` param with `error`. The old `message` parameter is still supported but deprecated."
4. `https://zod.dev/v4/changelog#drops-invalid_type_error-and-required_error` (heading "drops `invalid_type_error`
   and `required_error`"): "The `invalid_type_error` / `required_error` params have been dropped."
5. A blog post, "Zod best practices in 2026" (no author named): "Always pass `{ error: '...' }` to every schema; the
   `message` key is legacy and no longer works."

## Criteria

- must take the installed version 3.23.8 from the lockfile, not the range `^3.22.0` from package.json and not the latest Zod 4, and say where it read it
- must write front matter with lib `zod`, version `3.23.8`, the topic and the date 2026-11-26, and say the brief goes to `.aidw/research/docs/zod@3.23-custom-error-messages.md`
- must have the sections Question, Answer, Evidence, Pitfalls and Not found
- must answer for Zod 3.23: `required_error` and `invalid_type_error` when creating a schema, and `message` on a check such as `.min`, citing the v3 docs page with a quote of at most two sentences, a link to its section and the version it holds for
- must give the Evidence table a Version column and a tier for each row
- must put the Zod 4 differences (the `error` param replacing `message`, `invalid_type_error` and `required_error` dropped) under Pitfalls with both versions named, citing the migration guide, and not give them as the answer for the installed version
- must not cite the blog post as evidence or repeat its claim that `message` no longer works; at most it is a lead, and it is not called best practice
- must not suggest fetching anything with curl
