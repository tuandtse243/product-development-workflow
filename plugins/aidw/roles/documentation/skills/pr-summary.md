---
name: pr-summary
description: Write the pull request summary of a delivered Change - Why in one sentence, 1 to 3 notes, a change outline made of Views - laid out after html-effectiveness example 17, naming only files the diff or the approved package holds.
---

# Pull request summary

A reviewer opens the pull request and has to know in a minute why it exists, what to watch, and what changed where.
You write that part; `aidw pr` adds the rest from evidence (what differs from the approved package, what was not
built, tasks, quality layers, merge danger), so do not repeat it.

## The file: `.aidw/changes/<id>/delivery/pr-summary.md`

Lay it out after example 17 (`aidw plugin-path library/vendor/anthropics/html-effectiveness/17-pr-writeup.html`; the
html-pages skill says what to take from it), and say in your reply that you followed example 17. Keep its order,
not its colours or panels:

1. `# <title>`, then one line saying what the pull request does. `aidw pr` drops the title (the pull request has its
   own) and keeps the line.
2. `## Why`: one sentence, as the user sees it. Take it from `## Before / After` in `analysis.md` when the Change has
   one.
3. `## Notes`: 1 to 3 bullets a reviewer must not miss: a Deviation and what it changed (the Change's
   `deviations.yaml` records them), a migration and whether it
   is reversible, a step to run before merging. Nothing to say: one bullet, "Nothing beyond the plan."
4. `## Change outline`: Views, each a fenced block with its kind as the info string. First a ` ```tree ` block of the
   files that matter, one path from the project root per line, marked `+` new, `~` changed or `-` removed, with a few
   words on each. Then, only where it shows the point better than the tree, a ` ```diff ` of a changed signature, a
   ` ```calltree `, a ` ```component ` tree or ` ```pseudocode `. A code block names its file in a comment on its first
   line. Show the smallest View that makes the point (show-me), never the whole diff.
5. `## Where to focus your review` (optional): the one or two places where a mistake would hurt, each as `path:line`.

Leave out what `aidw pr` writes itself: the test plan is the Evidence, the rollout is Merge danger.

## Name only files that exist in the Change

`aidw pr` refuses the summary when it names a file that is neither in the git diff of the Change Branch nor an
approved Artifact (`analysis.md`, `program-design.md`, the specs, ...), and lists each one. It reads as a path:
anything in backticks or a link target that ends in a file extension (`app/api/route.ts:12-30`, `README.md`) or in
`/` (a folder), every line of a ` ```tree ` block, the headers of a git diff and the file comment on the first line
of another fenced block. A branch (`aidw/reschedule`), a route (`/api/bookings`), a package (`@scope/name`) or a glob
is not read as a path, nor a command in backticks (`node scripts/build.mjs`). A bare file name in prose
(`README.md`, but also `Next.js`) is never refused, so write a file you mean with its folder. It also warns, without refusing, when `## Why`, `## Notes` or `## Change outline` is missing. Take the paths from
`git diff --name-only <base>...HEAD`, not from the plan: a file the plan named and the code did not need is not in the
diff. Name such a file nowhere, not in the summary, not in your reply, not even to say it was not created: a plan is an
approved Artifact, the files it lists are not. Say it in words ("the separate lock module the plan named was not
needed") and put the path the code used instead.

## Right and wrong

Right:

````markdown
# Patients reschedule their own appointments

## Why

Clinic staff moved every booking by phone; now the patient moves it from the confirmation page.

## Notes

- Deviation D-1: the slot lock moved from the page to `app/api/bookings/route.ts`, approved on 2026-11-24.

## Change outline

```tree
+ app/api/bookings/route.ts      PATCH moves a booking to a free slot
~ app/(site)/book/page.tsx       Reschedule button on the confirmation
```
````

Wrong: "This PR improves the booking experience and refactors several files for maintainability", a list of all 23
files, a test plan retyped from the quality report, and `lib/booking/lock.ts`, which the plan named and the code never
created.

## Sources

Ideas, not wording: anthropics/html-effectiveness (MIT), example `17-pr-writeup` (the short answer, Why with before
and after, file by file, where to focus the review); HumanLayer `rpi` (MIT, github.com/humanlayer/skills,
`plugins/rpi`): `references/prose.md` (short, plain, the real names of things) and `show-me` (the smallest View that
shows the point).
