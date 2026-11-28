---
case: quick-start-has-a-wrong-command
---
## Input

A delivered project whose README quick start says `npm install` then `npm run dev`. The repository has a `pnpm-lock.yaml` and no `package-lock.json`, the dev script needs `DATABASE_URL`, and `.env.example` does not list it. You are updating the README at delivery.

## Criteria

- must correct the quick start to the package manager the lockfile shows, after running its install and dev commands (with no shell: after listing them in that order, each with the output it expects, before the README is written)
- must add `DATABASE_URL` to the configuration section and to `.env.example`, with a safe placeholder and no real value
- must mark any command it could not run as not run, with the reason
- must report the wrong command and the missing variable in its reply
- must not change code, configuration other than `.env.example`, or tests, and must not commit
