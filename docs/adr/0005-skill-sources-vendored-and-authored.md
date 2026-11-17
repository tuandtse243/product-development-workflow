# Skills come from many sources: vendored word for word, or authored from the best ideas

Status: accepted (2026-11-17)

The baseline had two vendor sources: Pocock for product, spec and tickets, Addy for engineering. A review of
public skills (2026-11-16) found that the best material for most Roles sits elsewhere (obra/superpowers,
getsentry/skills, supabase, docker, fastapi, anthropics, impeccable) and that several good sources
cannot be copied at all. We decided to open the vendor list and to keep two kinds of Skill:

- A **Vendored Skill** is copied word for word into `library/vendor/<source>/` with `UPSTREAM.md` and the
  upstream licence, and is never edited. Only MIT, Apache-2.0 and similar licences qualify. Material under
  CC BY-SA is kept in its own labelled directory, unmodified, and is used as lookup reference only.
- An **Authored Skill** is written by aidw and ends with a `Sources` section. We author when a source cannot be
  copied (non-commercial licence, no licence file, redistribution forbidden), when it is tied to its own tool
  (launchers, template variables, its own CLI), or when two or more good sources cover the same topic: one
  merged Skill replaces several overlapping ones. An Authored Skill takes ideas and methods, never wording or
  structure. It lives in the Role's folder when one Role uses it and in `library/` when several do, and stays
  near 150 lines with lookup material split into references.

A Vendored Skill is written for another setup (a human to ask, a pull request to open) and may contain errors.
Because it is never edited, what differs under aidw and what is known to be wrong is kept beside the vendor
directory in `library/vendored-skill-notes.md`, and a brief that loads such a Skill points there.

Pocock and Addy keep their assignments, and their vendored Skills stay as they are: an Authored Skill adds what
is missing and does not replace them. Skills are still loaded by signal per task (decision D-23); a framework
pack lists the Skills that load with it. Every Authored Skill ships with at least one Role eval.

## Considered Options

- **Stay with two sources.** Rejected: no good public material for database, devops, security review, the
  reviewer or the upstream Roles would be usable.
- **Vendor everything that has a permissive licence.** Rejected: topics with several sources (security review,
  task review, product discovery) would load overlapping Skills that cost tokens and contradict each other.
- **Author everything.** Rejected: where one source is already excellent and self-contained (Docker, FastAPI,
  Svelte, Postgres rules), a verbatim copy is cheaper to keep in step with upstream.
- **Drop sources that cannot be copied.** Rejected: a licence restricts copying the text, not learning the method.

## Consequences

- The repository carries a CC BY-SA directory that must stay unmodified and separately labelled.
- `scripts/vendor.config.json` grows from two sources to about fourteen; each re-sync is reviewed by `git diff`.
- An Authored Skill does not receive upstream improvements: its `Sources` section says where to look again.
