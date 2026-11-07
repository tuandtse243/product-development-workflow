---
name: init
description: Set up aidw in the current project (creates .aidw/). Use when the user runs /aidw:init or wants to use the aidw workflow in a project that has no .aidw/ yet.
disable-model-invocation: true
---

# aidw: initialize a project

1. If `aidw status` already finds a `.aidw/`, report its status and stop.
2. Classify the project:
   - **greenfield**: empty or only docs/briefs, no application code;
   - **brownfield**: existing application code (package manifests, `src/`, `app/` ...). Brownfield support
     (codebase assessment, baseline specs) arrives in workflow slice S10: say so, and keep the existing
     stack and conventions.
3. Run `aidw init`.
4. Edit `.aidw/project.yaml`: set `name`, and for brownfield record the detected stack under `stack.items`
   with `source: client` (existing projects keep their stack, Q9).
5. If the project is not a git repository, suggest `git init`. Git is needed for checkpoints, worktrees and
   the stop backstop.
6. Suggest adding `.aidw/` to version control (its own `.gitignore` already excludes `run/`).
7. Next step: `/aidw:start <idea | PRD | JD>`.
