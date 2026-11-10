---
name: init
description: Set up aidw in the current project (creates .aidw/). Use when the user runs /aidw:init or wants to use the aidw workflow in a project that has no .aidw/ yet.
disable-model-invocation: true
---

# aidw: initialize a project

The `aidw` CLI ships with this plugin as `${CLAUDE_PLUGIN_ROOT}/bin/aidw`. If a command fails with
`aidw: command not found`, run that path instead of `aidw` (here and in every command below).

1. If `aidw status` already finds a `.aidw/`, report its status and stop.
2. Run `aidw init`. It detects the project kind from the code and prints it:
   - **greenfield**: empty or only docs/briefs, no application code;
   - **brownfield**: existing application code. The detected stack goes into `.aidw/project.yaml`
     (`stack.items`, `source: client`: an existing project keeps its stack, Q9), with the package manager and
     the quality-layer commands its own scripts suggest (`detected:`). `aidw detect` shows them again.
3. Check `.aidw/project.yaml`: set `name`; for brownfield, correct anything detection got wrong (read
   `package.json` and the config files; never guess) and add what it cannot see (e.g. the hosting the client
   uses). Do not change the code.
4. Brownfield: tell the user that `/aidw:start` begins with an assessment of the existing code, and that the
   working tree must be committed or stashed first (aidw commits per task).
5. If the project is not a git repository, suggest `git init`. Git is needed for checkpoints, worktrees and
   the stop backstop.
6. Suggest adding `.aidw/` to version control (its own `.gitignore` already excludes `run/`).
7. Next step: `/aidw:start <idea | PRD | JD>`.
