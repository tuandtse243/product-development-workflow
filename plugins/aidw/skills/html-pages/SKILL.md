---
name: html-pages
description: Build an HTML page - a comparison of approaches, a walkthrough of code, a plan, a before and after, a report - modelled on the right html-effectiveness example and kept static and offline. Use when the user runs /aidw:html-pages or asks for an HTML page of a topic.
allowed-tools: Bash(aidw *), Read, Write
argument-hint: "[what the page is about]"
---

# aidw: HTML pages

The `aidw` CLI ships with this plugin as `${CLAUDE_PLUGIN_ROOT}/bin/aidw`. If a command fails with
`aidw: command not found`, run that path instead of `aidw` (here and in every command below).

1. Read `$(aidw vendor-path aidw/html-pages)` and follow it. It names the example that fits the kind of page asked
   for (the argument, or the topic of the conversation); read that example with the `aidw plugin-path` line it gives.
   The notes on the examples are in `$(aidw plugin-path library/vendored-skill-notes.md)`
   ("anthropics/html-effectiveness").
2. Every question or option on the page carries a View: pick it as `$(aidw vendor-path humanlayer/show-me)` says.
3. When the page asks the user to choose, it is a Decision Page: write its data and render it as
   `$(aidw plugin-path library/decision-pages.md)` says. Otherwise, when a CLI layout fits, render that; write HTML
   yourself only when none does.
4. A rendered page stays where `aidw page render` puts it. For a page you write yourself:
   Write it under `.aidw/run/pages/` when the project has `.aidw/`, otherwise under the system's temporary
   directory (`$TMPDIR`), unless the user names a place. Never open it: give its link and one or two lines on
   what it shows.
