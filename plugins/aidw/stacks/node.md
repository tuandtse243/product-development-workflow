# Stack pack: Node (JavaScript / TypeScript)

Applies to greenfield Next.js, Vite + React and NestJS/Express projects. Every stack pack answers the same
questions under the same headings (a test checks it), so adding a language means adding one file like this one
(ADR-0001). The language-neutral rules are in `library/code-style.md`.

## Package manager and install

pnpm. `pnpm install` for a fresh install, `pnpm install --frozen-lockfile` in CI. The sandbox may not write pnpm's
default store: it then puts `.pnpm-store/` in the project root (ignored below). `aidw doctor` checks the store.

Install safety, in `pnpm-workspace.yaml` (pnpm 10.16 and later):

```yaml
minimumReleaseAge: 4320 # minutes: three days, the same limit the aidw checkpoint applies to an added package
allowBuilds: # install scripts are blocked unless a package is listed here (pnpm 11 and later; pnpm 10 uses onlyBuiltDependencies)
  esbuild: true
```

Setting `minimumReleaseAge` yourself also makes it strict: an install that needs a newer version fails instead of
falling back. List a package under `allowBuilds` only when its build step is needed (`esbuild`, `sharp`, a
database driver); never set `dangerouslyAllowAllBuilds`.

## Formatter

prettier, with `.prettierrc` `{ "semi": true, "singleQuote": true, "printWidth": 100, "trailingComma": "all" }`
(the constitution may override it when the client requires another style) and a `.prettierignore` listing
`node_modules`, build output (`.next`, `dist`), `pnpm-lock.yaml`, `test-results`, `.pnpm-store`, `.vitest`, `.aidw`.
Scripts: `"format": "prettier --write ."`, `"format:check": "prettier --check ."`. Run
`pnpm exec prettier --write .` once at the end of the scaffold task so the first commit is clean.

## Linter

The linter depends on the TypeScript major the scaffold installs, because the type-aware rules need the compiler:

- **TypeScript 7 (the default for a new project): oxlint.** Dev dependencies `oxlint` and `oxlint-tsgolint`,
  script `"lint": "oxlint"`. typescript-eslint does not support TypeScript 7 (it has no compiler API yet), and
  oxlint's type-aware mode needs TypeScript 7.
- **TypeScript 6 or lower, or a framework whose scaffold ships ESLint: ESLint flat config** with
  `typescript-eslint`'s `strictTypeChecked` and `stylisticTypeChecked` and
  `languageOptions: { parserOptions: { projectService: true } }`, plus `@vitest/eslint-plugin`,
  `eslint-plugin-react-hooks` (`configs.flat.recommended`) and `eslint-plugin-jsx-a11y` (`flatConfigs.strict`) where
  they apply. Use the ESLint major every plugin supports: `eslint-plugin-jsx-a11y` 6 stops at ESLint 9.

`.oxlintrc.json` for a new project (drop `react`, `jsx-a11y` and `nextjs` when there is no UI):

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["eslint", "typescript", "unicorn", "oxc", "import", "promise", "vitest", "react", "jsx-a11y", "nextjs"],
  "categories": { "correctness": "error", "suspicious": "error" },
  "options": { "typeAware": true },
  "rules": {
    "typescript/no-explicit-any": "error",
    "typescript/no-misused-promises": "error",
    "typescript/no-unsafe-assignment": "error",
    "import/no-cycle": "error",
    "complexity": ["error", { "max": 12 }],
    "max-depth": ["error", { "max": 4 }],
    "max-params": ["error", { "max": 4 }],
    "max-lines-per-function": ["error", { "max": 80, "skipBlankLines": true, "skipComments": true }]
  },
  "overrides": [
    { "files": ["**/*.{test,spec}.{ts,tsx}", "tests/**", "e2e/**"], "rules": { "max-lines-per-function": "off" } }
  ]
}
```

`plugins` replaces the default set, so the four defaults (`eslint`, `typescript`, `unicorn`, `oxc`) are listed too.
`vitest/no-focused-tests` and `vitest/no-disabled-tests` are in `correctness`, so a `.only` or a skipped test is a
lint error. The limits (complexity 12, depth 4, four parameters, 80 lines) are where a function is split, not
suppressed: a suppression needs its reason on the same line and the reviewer judges it.

## Typecheck

`pnpm exec tsc --noEmit` (the `code` layer). `tsconfig.json` of a new project turns on what `strict` leaves off:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "noUncheckedSideEffectImports": true,
    "verbatimModuleSyntax": true
  }
}
```

TypeScript 7 rejects `baseUrl`, `target: es5`, `downlevelIteration` and the `node`/`node10`/`classic` module
resolutions: use `paths` without `baseUrl` and `moduleResolution: "bundler"` (or `nodenext`). If the framework's
own generated tsconfig conflicts with a flag above, keep the framework's value and say so in the scaffold report.

## Test runner and JUnit output

Playwright sets `forbidOnly: !!process.env.CI`. Vitest with two projects, `unit` (`lib/**/*.test.ts`, components) and `integration` (`tests/integration/**`);
Playwright for `e2e`, `a11y` and `shots`. JUnit: `--reporter=junit --outputFile.junit=test-results/<layer>.xml`
for Vitest, and for Playwright `reporter: [['list'], ['junit', { outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT_NAME ?? 'test-results/e2e.xml' }]]`.
A layer that declares `reports:` and writes none fails verify.

## Dead code and architecture

Both run in the `code` layer of a new project, after lint:

- **knip** (`pnpm exec knip`): unused files, exports and dependencies. It exits non-zero on any finding. Entry
  points it cannot see go in `knip.json`, never a blanket ignore.
- **dependency-cruiser** (`pnpm exec dependency-cruiser src`, config `.dependency-cruiser.js` from
  `pnpm exec dependency-cruiser --init`): keep the generated `no-circular` rule at `severity: "error"`, and add one
  `forbidden` rule per boundary the architecture names (UI does not import the database client; a feature folder
  does not import another feature's internals).

## Coverage on new code

Vitest with `coverage: { provider: "v8", reporter: ["text", "lcov"] }`. The `unit` layer then checks the lines the
Change added, not the whole project: at least 80% of them are covered, config and generated files excluded (see
`roles/qa/references/quality-layers.md`, "Coverage on the diff").

## Pre-commit hook

husky + lint-staged. `package.json`: `"prepare": "husky"`, and lint-staged
`"*.{ts,tsx,js,jsx,mjs,cjs}": ["prettier --write", "oxlint --fix"]` (`eslint --fix` on the ESLint path), `"*.{json,md,css,yml,yaml}": ["prettier --write"]`.
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

`roles/devops/references/ci.md` has the GitHub Actions workflow; for Node it installs with pnpm and runs the `code` and `unit`
layer commands.
