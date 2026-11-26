---
name: readme-structure
description: Write or update a README that lets someone who was not there run, use and change the project - with commands that were actually run.
---

# README

The README is the first and often the only document read. It answers, in order: what is this, how do I run it,
how do I use it, how do I change it. Describe what exists. Never what was planned.

## Before writing

- Read the existing README and keep what is true: update it, do not replace someone's document with a template.
- Read the manifest scripts, the environment template, the compose file and the CI workflow: the README must agree
  with them.
- Take the package manager from the lockfile, not from the old README: `pnpm-lock.yaml` is pnpm, `yarn.lock` is
  yarn, `bun.lock` or `bun.lockb` is bun, `package-lock.json` is npm.
- **Run every command you will write, before you write it**, from a state as close to a fresh clone as you can get:
  install, then the start or dev script, then the check that it works. Write the quick start from what ran. A command
  you could not run (it needs a credential, a paid service, a deploy, or there is no shell) is still listed in the
  order you would run it, with the output you expect, and marked "not run here" with the reason that stopped it.
- A command that needs an environment variable you know the template does not list (you read the template, or the
  brief says so): add the name to `.env.example` with a safe placeholder, and report it as a difference. A variable
  you only suspect is missing is reported, not added.

## Sections, in this order (leave out what does not apply)

1. **Name and one paragraph**: what it does and for whom. No badges wall, no slogans.
2. **Requirements**: runtime and tool versions as the project pins them, and the services it needs.
3. **Quick start**: from clone to running, as a numbered list of commands that work when pasted in order. Then
   how to see that it works (a URL, a command, the expected output).
4. **Configuration**: every environment variable: name, what it is for, whether it is required, a safe example.
   The names match `.env.example`. Never a real value.
5. **Usage**: the main things a user does. For a library or a CLI, the smallest complete example. For an API, a
   link to the API documentation and one example call.
6. **Development**: how to run the tests, the linter and the type check; how the code is organised (a short map,
   not a file listing); how to add a migration; the commit convention.
7. **Deployment**: how it is deployed and what must be set; link the deployment checklist when there is one.
8. **Known issues and limits**: what does not work, what was not covered by tests, what is deliberately left out.
9. **Licence and contact**, when the project has them.

## By kind of project

- **Web application**: quick start includes the database and a seed; say which URL and which test account.
- **API service**: how to authenticate in a local call; where the contract is.
- **Library**: install, the smallest example, supported versions, the stability of the API.
- **CLI**: install, the three most used commands with output, where configuration is read from.

## Rules

- Short sentences, present tense, the reader as "you". Code in fenced blocks with the language.
- No statement about the future. No "simply" or "just".
- If a step can fail in a known way, say what the error looks like and what fixes it.
- A longer topic gets its own file under `docs/` and one line here that links to it.

## Sources

Ideas, not wording: the Diátaxis framework (tutorial, how-to, reference, explanation are different documents),
GitHub's guidance on READMEs, Make a README, the Google developer documentation style guide, and Addy Osmani's
`documentation-and-adrs` (vendored).
