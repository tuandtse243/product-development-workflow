# Every question with options carries a View; pages are built from a library of examples

Status: accepted (2026-11-26)

Options described in words are hard to compare, and the owner wants every question put to a user or a client to be
shown, not told. A question with options (on a Decision Page, in a gate section, or asked in the chat) now carries at
least one **View**, chosen as the vendored `show-me` skill says: the smallest of a diff, a file tree, a call tree, a
component tree, pseudocode or a mock that shows the point. Decision Page data gets a `view:` field that the CLI
renders, and `aidw page render` refuses a question with options that has none. A yes or no and a name are exempt.

How a page looks comes from the 20 examples of anthropics/html-effectiveness, vendored word for word under ADR-0005,
through an Authored Skill, `html-pages`, that says which example fits which kind of page and what to take from it.
It serves both kinds of HTML: the CLI's own layouts (new ones modelled on the examples for comparing approaches,
walking through code, a plan, and before and after) and the HTML an Agent writes (the `html` slot, the Existing
System Report, the pull request write-up). Both skills can also be invoked by the user (`/aidw:show-me`,
`/aidw:html-pages`).

## Considered Options

- **Required for technical questions and the gate only.** Rejected: product choices are also clearer with a mock or
  a before and after.
- **Recommended, not checked.** Rejected: a rule the CLI does not check is forgotten.
- **Examples only for the CLI's layouts, or only for Agents.** Rejected: the pages the user sees would speak two
  visual languages.
