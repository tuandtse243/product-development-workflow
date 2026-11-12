# Stack pack: Node (JavaScript / TypeScript)

Applies to greenfield Next.js, Vite + React and NestJS/Express projects. Every stack pack answers the same
questions under the same headings (a test checks it), so adding a language means adding one file like this one
(ADR-0001). The language-neutral rules are in `profiles/code-style.md`.

## Package manager and install

pnpm. `pnpm install` for a fresh install, `pnpm install --frozen-lockfile` in CI. The sandbox may not write pnpm's
default store: it then puts `.pnpm-store/` in the project root (ignored below). `aidw doctor` checks the store.

## Formatter

prettier, with `.prettierrc` `{ "semi": true, "singleQuote": true, "printWidth": 100, "trailingComma": "all" }`
(the constitution may override it when the client requires another style) and a `.prettierignore` listing
`node_modules`, build output (`.next`, `dist`), `pnpm-lock.yaml`, `test-results`, `.pnpm-store`, `.vitest`, `.aidw`.
Scripts: `"format": "prettier --write ."`, `"format:check": "prettier --check ."`. Run
`pnpm exec prettier --write .` once at the end of the scaffold task so the first commit is clean.

## Linter

eslint with the stack's usual config (`eslint-config-next`, `typescript-eslint`...). Pin versions the stack's config
supports (eslint 9 with `eslint-config-next` 15).

## Typecheck

`pnpm exec tsc --noEmit` (the `code` layer).

## Test runner and JUnit output

Vitest with two projects, `unit` (`lib/**/*.test.ts`, components) and `integration` (`tests/integration/**`);
Playwright for `e2e`, `a11y` and `shots`. JUnit: `--reporter=junit --outputFile.junit=test-results/<layer>.xml`
for Vitest, and for Playwright `reporter: [['list'], ['junit', { outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT_NAME ?? 'test-results/e2e.xml' }]]`.
A layer that declares `reports:` and writes none fails verify.

## Pre-commit hook

husky + lint-staged. `package.json`: `"prepare": "husky"`, and lint-staged
`"*.{ts,tsx,js,jsx,mjs,cjs}": ["prettier --write", "eslint --fix"]`, `"*.{json,md,css,yml,yaml}": ["prettier --write"]`.
`.husky/pre-commit` contains `pnpm exec lint-staged`. The hook does not run tsc, build or tests: the quality layers
own those.

## Commit messages

Dev dependencies `@commitlint/cli` and `@commitlint/config-conventional`, `commitlint.config.js`:

```js
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 72],
    'subject-case': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
```

`.husky/commit-msg` contains `pnpm exec commitlint --edit $1`. (`subject-case` and the line limits are off because
aidw footers carry long evidence paths and titles may start with an acronym.)

## Paths never committed

`node_modules/`, `.next/`, `.nuxt/`, `.svelte-kit/`, `.turbo/`, `.vercel/`, `.pnpm-store/`, `.vitest/`, `coverage/`,
`playwright-report/`, `test-results/`, `*.tsbuildinfo`, `next-env.d.ts`, `.env*` (except `.env.example`).
`src/git.ts` refuses to commit these.

## .gitignore template

```
node_modules/
.next/
dist/
coverage/
.vercel/
.pnpm-store/
.vitest/
playwright-report/
test-results/
*.tsbuildinfo
next-env.d.ts
.env*
!.env.example
```

## CI

`profiles/ci.md` has the GitHub Actions workflow; for Node it installs with pnpm and runs the `code` and `unit`
layer commands.
