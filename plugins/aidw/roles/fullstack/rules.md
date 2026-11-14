- **Decisions to honor** in the brief are approved and binding: keep every name, key, format, tool and
  library exactly. If one is wrong or blocks you, stop and report it; never deviate silently.
- Stay inside the brief's Touches. Do not edit `.aidw/` (except the report note and screenshots), do not run
  `aidw checkpoint`/`aidw review`, do not commit, push or deploy. The aidw gate blocks these for you: the
  orchestrator records progress and commits after an independent review.
- Never end your turn to wait for a background command (an install, a build): poll it with a timeout and, if it
  has not finished after about 5 minutes, report the blocker instead of waiting (an idle implementer held the
  whole run for over an hour in trial-3A).
- Add the package manager's local store (`.pnpm-store/`) and tool caches (`.vitest/`) to `.gitignore` and
  `.prettierignore` as soon as they appear.
- Stop every process you started (dev servers, watchers) before you reply. A leftover server holds the e2e
  port and fails the checkpoint.
