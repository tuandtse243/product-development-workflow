---
name: release-notes
description: Write release notes for the people who use and operate the software, from the Change's commits, specs and evidence - what changed for them, not what was committed.
---

# Release notes

Commits are written for developers. Release notes are for the user who wants to know what is different and the
operator who wants to know what to do. Build them from what was delivered, and state nothing you cannot point to.

## 1. Gather

- the commits of the Change (`git log --no-merges <base>..HEAD`): their types tell you the section, and a `!` or
  a `BREAKING CHANGE:` footer is never left out;
- the requirements and delta specs: what each new behavior is for, in the user's words;
- the quality report and evidence: what was verified, what was not covered;
- migrations, new environment variables, changed configuration: what an operator must do.

## 2. Write for the reader

Group by what it means to them, most important first:

- **Breaking changes**: what stops working, who is affected, exactly what to do. First, always, if any.
- **New**: what the user can now do. One line each, starting with the capability, not the component.
- **Changed**: behavior that differs from before, and why.
- **Fixed**: the symptom the user saw, not the cause in the code.
- **Security**: what was hardened, without a recipe for attacking older versions.
- **For operators**: migrations (and whether they can be undone), new or changed environment variables (names
  only), new services, anything to run before or after deploying.

Leave out refactors, tests, tooling and anything a user cannot notice. Several commits that make one visible
change are one line. Do not copy commit subjects. Do not thank, announce or sell.

## 3. Be exact

- Every line can be traced to a requirement, a scenario or a commit: keep the id in a comment or a trailing
  reference when the project's format allows.
- "Known issues and limits": what the quality report lists as not covered or failed and accepted. Never omit it
  to look finished.
- The version follows the project's scheme; with semantic versioning a breaking change is a major, a new
  capability a minor, a fix a patch. You propose the number; the user decides it.

## Output

`changes/<id>/release.md`, section `## Release notes`. When the project keeps a `CHANGELOG.md`, the same content
in its existing format is proposed there in the delivery step, not written by you before it.

## Sources

Ideas, not wording: Keep a Changelog (changelogs are for humans; group by kind of change), Conventional Commits
and Semantic Versioning for the mapping from commits to sections and version, and Addy Osmani's
`shipping-and-launch` (vendored) for what a launch needs.
