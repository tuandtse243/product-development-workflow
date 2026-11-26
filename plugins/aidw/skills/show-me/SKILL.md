---
name: show-me
description: Show the current topic or question as the smallest View that makes the point - a diff, a file tree, a call tree, a component tree, pseudocode or a focused HTML page. Use when the user runs /aidw:show-me or asks to be shown a choice, a change or how something works.
allowed-tools: Bash(aidw *), Read, Write
argument-hint: "[what to show]"
---

# aidw: show me

The `aidw` CLI ships with this plugin as `${CLAUDE_PLUGIN_ROOT}/bin/aidw`. If a command fails with
`aidw: command not found`, run that path instead of `aidw` (here and in every command below).

1. Read `$(aidw vendor-path humanlayer/show-me)` (vendored word for word) and its section of
   `$(aidw plugin-path library/vendored-skill-notes.md)` ("humanlayer/show-me"). Follow the skill: skip the preamble
   and pick the smallest View for what the user asked about (the argument, or the topic of the conversation).
2. Show a diff, a tree, a call tree, a component tree or pseudocode in the chat as a fenced block, next to the one or
   two lines it supports. When the View is for a choice, give the options under it with your recommendation, as
   `library/decision-pages.md` shows for a question asked in the chat.
3. Only when the point is a look, a layout or something too dense for a block, write one HTML page, modelled on an
   example as `$(aidw vendor-path aidw/html-pages)` says.
   Write it under `.aidw/run/pages/` when the project has `.aidw/`, otherwise under the system's temporary
   directory (`$TMPDIR`), unless the user names a place. Never open it: give its link and one or two lines on
   what it shows.
4. Do not change code or record a decision: this command only shows.
