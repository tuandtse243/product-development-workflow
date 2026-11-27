import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { copyPluginForSession } from "../src/evallevel2.js";
import { sharedDigest, workingDigest } from "../src/evals.js";
import { cleanTemps, gitBase, project, roleScript, runScript, write } from "./rolescripts.js";

// False positives and false negatives of the frontend Role's scripts on realistic React/TSX code, input edge cases,
// and the move of _common.mjs to library/scripts/. A test named "BUG: ..." states the behaviour the spec asks for and
// fails until the script is fixed.
const S = (name: string) => roleScript("frontend", name);
const PLUGIN = join(__dirname, "..", "plugins", "aidw");
const temps: string[] = [];
afterAll(() => {
  cleanTemps();
  temps.forEach((t) => rmSync(t, { recursive: true, force: true }));
});

const tok = (root: string, args: string[] = []) => runScript(S("token-literals.mjs"), [root, ...args]);
const a11y = (root: string, args: string[] = []) => runScript(S("a11y-names.mjs"), [root, ...args]);
const env = (root: string, args: string[] = []) => runScript(S("public-env-scan.mjs"), [root, ...args]);
const lits = (r: { json: any }) => r.json.findings.map((f: any) => `${f.file}:${f.line} ${f.kind} ${f.literal}`);
const probs = (r: { json: any }) => r.json.findings.map((f: any) => `${f.file}:${f.line} ${f.problem} ${f.element}`);
const git = (root: string, ...a: string[]) => {
  const r = spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
};

const TOKENS = [
  "tokens:",
  '  - { name: accent, kind: color, value: "#E5533D" }',
  "  - { name: space-2, kind: space, value: 8px }",
  "  - { name: space-4, kind: space, value: 1rem }",
  "  - { name: radius-md, kind: radius, value: 6px }",
  '  - { name: body, kind: font, value: "Inter, sans-serif" }',
  "  - { name: z-modal, kind: other, value: 50 }",
].join("\n");

// ---------------------------------------------------------------- a11y-names: components

describe("a11y-names on components", () => {
  it("takes an aria-label passed through props and an element given spread props as named", () => {
    const root = project({
      "src/Close.tsx": [
        'import { X } from "lucide-react";',
        "export function CloseButton({ label, ...rest }: Props) {",
        "  return <button aria-label={label} {...rest}><X /></button>;",
        "}",
        "export function Close2({ label }: Props) {",
        "  return <button aria-label={label}><X /></button>;",
        "}",
        "export function Close3(props: Props) {",
        "  return <button {...props}><X /></button>;",
        "}",
        "export function Close4({ ariaLabel }: Props) {",
        '  return <button aria-label={ariaLabel ?? undefined} type="button"><X /></button>;',
        "}",
      ].join("\n"),
    });
    expect(a11y(root).json.findings).toEqual([]);
  });

  it("does not look into a <Button> wrapper: neither its use with an icon only nor its own spread <button>", () => {
    const root = project({
      "src/Button.tsx": [
        'import { Trash } from "lucide-react";',
        'export const Button = ({ children, ...p }) => <button className="btn" {...p}>{children}</button>;',
        "export const Page = () => (",
        "  <div>",
        "    <Button onClick={del}><Trash /></Button>",
        '    <Button aria-label="Delete" onClick={del}><Trash /></Button>',
        "  </div>",
        ");",
      ].join("\n"),
    });
    expect(a11y(root).json.findings).toEqual([]);
  });

  it("binds a field by <label htmlFor>, by a wrapping label over several lines, by a run-time id and by aria-labelledby", () => {
    const root = project({
      "src/Form.tsx": [
        "export const F = ({ id }) => (",
        "  <form>",
        '    <label htmlFor="name">Name</label>',
        '    <input id="name" />',
        '    <label>Email<input type="email" /></label>',
        "    <label>",
        "      Bio",
        "      <textarea />",
        "    </label>",
        '    <label htmlFor="x">X</label><input id="y" />',
        "    <label htmlFor={id}>Dyn</label><input id={id} />",
        '    <span id="phone-l">Phone</span><input aria-labelledby="phone-l" />',
        '    <input aria-labelledby="" />',
        '    <input aria-label="" />',
        '    <input type="checkbox" />',
        '    <input type="submit" value="Go" />',
        "  </form>",
        ");",
      ].join("\n"),
    });
    // 10: htmlFor names another id; 13, 14: an empty name is no name; 15: a checkbox needs a label too.
    expect(probs(a11y(root))).toEqual([
      "src/Form.tsx:10 no-label input",
      "src/Form.tsx:13 no-label input",
      "src/Form.tsx:14 no-label input",
      "src/Form.tsx:15 no-label input",
    ]);
  });

  it("skips a field given react-hook-form's spread, but a placeholder is not a label", () => {
    const root = project({ "src/R.tsx": "export const R = ({ register }) => <form><input {...register('email')} /><input placeholder=\"Search\" /></form>;\n" });
    expect(probs(a11y(root))).toEqual(["src/R.tsx:1 no-label input"]);
  });

  it("names a control by aria-labelledby, title or an image's alt; an alt=\"\" image or an empty role=switch is no name", () => {
    const root = project({
      "src/D.tsx": [
        'import { Gear } from "lucide-react";',
        "export const D = () => (",
        "  <>",
        '    <h2 id="t">Settings</h2>',
        '    <button aria-labelledby="t"><Gear /></button>',
        '    <div role="button" tabIndex={0} onKeyDown={k} onClick={c} aria-labelledby="t"><Gear /></div>',
        '    <div role="switch" tabIndex={0} onKeyDown={k} onClick={c}></div>',
        '    <a href="/x" title="Home"><Gear /></a>',
        '    <a href="/x"><img src="h.png" alt="Home" /></a>',
        '    <a href="/x"><img src="h.png" alt="" /></a>',
        "    <a href=\"/x\"><img src=\"h.png\" alt={t('home')} /></a>",
        "  </>",
        ");",
      ].join("\n"),
    });
    expect(probs(a11y(root))).toEqual(["src/D.tsx:7 no-name div", "src/D.tsx:10 no-name a"]);
  });

  it("does not take TypeScript generics and comparisons for tags, and finds an onClick inside a .map()", () => {
    const root = project({
      "src/G.tsx": [
        "function id<T>(x: T): T { return x; }",
        "const m = new Map<string, number>();",
        "const ok = a < b && c > d;",
        "export const G = <T,>({ items }: { items: T[] }) => (",
        "  <ul>{items.map((i) => <li key={String(i)} onClick={() => pick(i)}>{String(i)}</li>)}</ul>",
        ");",
        "const arrow = async <T,>(x: T) => x;",
      ].join("\n"),
    });
    expect(probs(a11y(root))).toEqual(["src/G.tsx:5 div-click li"]);
  });

  it("BUG: a host input named by a <Label htmlFor> component (shadcn/ui, Radix) is labelled", () => {
    const root = project({
      "src/L.tsx": [
        "import { Label } from '@/components/ui/label';",
        "export const F = () => (",
        "  <form>",
        '    <Label htmlFor="email">Email</Label>',
        '    <input id="email" type="email" />',
        "  </form>",
        ");",
      ].join("\n"),
    });
    expect(probs(a11y(root))).toEqual([]);
  });

  it("BUG: a URL in JSX text does not hide the rest of its line (// is not a comment there)", () => {
    const root = project({
      "src/U.tsx": [
        "import { X } from 'lucide-react';",
        "export const U = () => (",
        "  <footer>",
        "    <p>Docs: https://docs.example.com</p> <button><X /></button>",
        "    <button><X /></button>",
        "  </footer>",
        ");",
      ].join("\n"),
    });
    expect(probs(a11y(root))).toEqual(["src/U.tsx:4 no-name button", "src/U.tsx:5 no-name button"]);
  });
});

// ---------------------------------------------------------------- a11y-names: images, outlines, raw HTML

describe("a11y-names on images, outlines and raw HTML", () => {
  it("takes an alt computed from an expression as present, and needs alt on next/image's Image", () => {
    const root = project({
      "src/E.tsx": [
        "import Image from 'next/image';",
        "export const E = ({ user, src, alt }) => (",
        "  <>",
        "    <img src={src} alt={user.name} />",
        "    <img src={src} alt={`Avatar of ${user.name}`} />",
        "    <img src={src} alt={alt ?? ''} />",
        "    <img src={src} alt />",
        "    <Image src={src} alt={t('logo')} width={10} height={10} />",
        "    <Image src={src} width={10} height={10} />",
        '    <img src={src} alt="" role="presentation" />',
        "  </>",
        ");",
      ].join("\n"),
    });
    expect(probs(a11y(root))).toEqual(["src/E.tsx:9 no-alt Image"]);
  });

  it("reads outline-none in clsx and template class strings; focus-visible: must be in the same string (limit)", () => {
    const root = project({
      "src/O.tsx": [
        "import clsx from 'clsx';",
        "export const O = ({ on }) => (",
        "  <>",
        "    <button className={clsx('outline-none', on && 'ring-2')}>A</button>",
        "    <button className={cn('outline-none', 'focus-visible:ring-2')}>B</button>",
        "    <button className={`outline-none ${on ? 'x' : 'y'} focus-visible:ring-2`}>C</button>",
        '    <button className="focus:outline-none focus-visible:ring">D</button>',
        "    <button style={{ outline: 'none' }}>E</button>",
        "  </>",
        ");",
      ].join("\n"),
    });
    // Line 5 is the documented limit: the focus-visible: class sits in another string of the same cn() call.
    expect(probs(a11y(root))).toEqual(["src/O.tsx:4 outline-removed button", "src/O.tsx:5 outline-removed button", "src/O.tsx:8 outline-removed button"]);
  });

  it("accepts dangerouslySetInnerHTML through a sanitizer call, on one line or several, and flags the rest", () => {
    const root = project({
      "src/F.tsx": [
        "import DOMPurify from 'dompurify';",
        "import sanitizeHtml from 'sanitize-html';",
        "export const F = ({ html }) => (",
        "  <>",
        "    <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />",
        "    <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(html, opts) }} />",
        "    <div dangerouslySetInnerHTML={{ __html: purify(html) }} />",
        "    <div dangerouslySetInnerHTML={{ __html: clean }} />",
        "    <div dangerouslySetInnerHTML={{ __html: marked(html) }} />",
        "    <div",
        "      dangerouslySetInnerHTML={{",
        "        __html: DOMPurify.sanitize(html),",
        "      }}",
        "    />",
        "  </>",
        ");",
        "el.innerHTML = DOMPurify.sanitize(x);",
        "el.innerHTML = x; // sanitize later",
        "const unsanitized = 1; el.innerHTML = y;",
      ].join("\n"),
    });
    // 8: a value sanitized elsewhere is not seen (documented limit); 18: a comment is not a call; 19: the name before the sink does not count.
    expect(probs(a11y(root))).toEqual([
      "src/F.tsx:8 raw-html div",
      "src/F.tsx:9 raw-html div",
      "src/F.tsx:18 raw-html innerHTML",
      "src/F.tsx:19 raw-html innerHTML",
    ]);
  });
});

// ---------------------------------------------------------------- token-literals

describe("token-literals on derived values and realistic styles", () => {
  it("reads var(), color-mix(), calc() and theme() as derived, but not a literal mixed into them", () => {
    const root = project({
      ".aidw/design/tokens.yaml": TOKENS,
      "src/a.css": [
        ".a { color: var(--accent); background: var(--bg, #123456); }",
        ".b { color: color-mix(in srgb, var(--accent) 80%, transparent); }",
        ".c { color: color-mix(in oklch, var(--accent), #222222); }",
        ".d { padding: calc(var(--space-2) * 2); margin: calc(var(--space-2) + 3px); }",
        ".e { width: calc(100% - 2 * var(--space-4)); }",
        ".f { color: theme('colors.accent'); padding: theme(spacing.4); }",
        ".g { border: 1px solid rgba(0, 0, 0, 0.1); margin: 0; top: -1px; inset: 0px; }",
        ".h { color: hsl(10 80% 50%); background: hsla(10, 80%, 50%, 0.5); }",
        ".i { box-shadow: 0 0 0 1px var(--line); }",
        ".j { color: rgba(229, 83, 61, 1); background: rgb(229 83 61); }",
        ".k { margin: 1px; padding: 0rem; }",
        ".l { background-image: url('/img/#ffeedd.png'); }",
        ".m { font: 14px/1.5 var(--font-body); }",
        ".n { color: #fff; background: rgba(0,0,0,0); }",
        ".o { color: var(--a, var(--b, #999999)); }",
      ].join("\n"),
    });
    const r = tok(root);
    // A var() fallback is skipped with the var() (help: "its var() parts are skipped").
    expect(lits(r)).toEqual([
      "src/a.css:3 color #222222",
      "src/a.css:4 length 3px",
      "src/a.css:7 color rgba(0, 0, 0, 0.1)",
      "src/a.css:8 color hsl(10 80% 50%)",
      "src/a.css:8 color hsla(10, 80%, 50%, 0.5)",
      "src/a.css:13 length 14px",
    ]);
    // rgb() and rgba(..., 1) of the accent are the token's value written in place.
    expect(r.json.tokenValues.map((t: any) => `${t.line} ${t.literal} ${t.token}`)).toEqual(["10 rgb(229 83 61) accent", "10 rgba(229, 83, 61, 1) accent"]);
  });

  it("reads SVG fill and stroke attributes; currentColor and var() are fine", () => {
    const root = project({
      ".aidw/design/tokens.yaml": TOKENS,
      "src/Icon.tsx": [
        "export const I = () => (",
        '  <svg viewBox="0 0 24 24" width={24} height={24}>',
        '    <path fill="#e5533d" stroke="#333333" strokeWidth={2} d="M0 0" />',
        '    <circle fill="currentColor" stroke="var(--accent)" />',
        "    <rect fill={'#444444'} />",
        "  </svg>",
        ");",
      ].join("\n"),
    });
    const r = tok(root);
    expect(lits(r)).toEqual(["src/Icon.tsx:3 color #333333", "src/Icon.tsx:5 color #444444"]);
    expect(r.json.tokenValues.map((t: any) => `${t.line} ${t.literal}`)).toEqual(["3 #e5533d"]);
  });

  it("reads Tailwind arbitrary values built with clsx/cn, object keys and template strings, and skips var()/theme() ones", () => {
    const root = project({
      ".aidw/design/tokens.yaml": TOKENS,
      "src/T.tsx": [
        "import clsx from 'clsx';",
        "export const T = ({ on, size }) => (",
        "  <div className={clsx('p-[13px]', on && 'bg-[#123456]', { 'mt-[7px]': on })}>",
        "    <span className={cn('text-[15px]', size === 'lg' && 'w-[320px]')} />",
        "    <span className={`p-[${size}px] m-[9px] ${on ? 'gap-[11px]' : ''}`} />",
        '    <span className="bg-[var(--accent)] p-[theme(spacing.2)] text-[length:var(--x)]" />',
        '    <span className="p-[8px] rounded-[6px] w-[1px] m-[0px] -mt-[4px] top-[-8px]" />',
        '    <span className="bg-[rgba(0,0,0,0.5)] text-[hsl(10_80%_50%)] fill-[#aaaaaa] stroke-[#bbbbbb]" />',
        '    <span className="!p-[13px] bg-[#123456]/50 md:hover:-m-[13px]" />',
        "  </div>",
        ");",
      ].join("\n"),
    });
    const r = tok(root);
    expect(lits(r)).toEqual([
      "src/T.tsx:3 color bg-[#123456]",
      "src/T.tsx:3 length mt-[7px]",
      "src/T.tsx:3 length p-[13px]",
      "src/T.tsx:4 length text-[15px]",
      "src/T.tsx:4 length w-[320px]",
      "src/T.tsx:5 length gap-[11px]",
      "src/T.tsx:5 length m-[9px]",
      "src/T.tsx:7 length -mt-[4px]",
      "src/T.tsx:8 color bg-[rgba(0,0,0,0.5)]",
      "src/T.tsx:8 color fill-[#aaaaaa]",
      "src/T.tsx:8 color stroke-[#bbbbbb]",
      "src/T.tsx:8 color text-[hsl(10_80%_50%)]",
      "src/T.tsx:9 color bg-[#123456]",
      "src/T.tsx:9 length -m-[13px]",
      "src/T.tsx:9 length p-[13px]",
    ]);
    expect(r.json.tokenValues.map((t: any) => `${t.line} ${t.literal}`)).toEqual(["7 p-[8px]", "7 top-[-8px]", "7 rounded-[6px]"]);
  });

  it("does not read comments, prose, ids, anchors with non-hex letters or media queries as styles", () => {
    const root = project({
      ".aidw/design/tokens.yaml": TOKENS,
      "src/N.ts": [
        "// color: #abcdef; padding: 13px",
        "/* .x { margin: 21px } */",
        "export const msg = 'Use 13px padding';",
        "export const id = 'issue #123456';",
        "export const anchor = '#section-2';",
        "export const url = 'https://x.dev/#fff';",
        "export const media = window.matchMedia('(min-width: 768px)');",
        "export const sizes = '(max-width: 640px) 100vw, 50vw';",
        "throw new Error('Expected 12px got 14px');",
        "export const hex = '#c0ffee';",
      ].join("\n"),
    });
    // Only a string that is one color literal counts (documented).
    expect(lits(tok(root))).toEqual(["src/N.ts:10 color #c0ffee"]);
  });

  it("reads style objects: unitless and 0 values are fine, numbers are px, a template with ${} is not read", () => {
    const root = project({
      ".aidw/design/tokens.yaml": TOKENS,
      "src/S.tsx": [
        "export const S = ({ w, rest }) => (",
        "  <div style={{ width: w, height: `${w}px`, padding: 0, margin: '0 auto', borderRadius: 4, lineHeight: 1.5, flex: 1, fontWeight: 600, zIndex: 999, top: '-1px', ...rest }}>",
        "    <p style={{ color: 'rgba(229, 83, 61, 1)', borderColor: 'var(--accent)', boxShadow: '0 4px 8px rgba(0,0,0,.2)' }} />",
        "  </div>",
        ");",
      ].join("\n"),
    });
    const r = tok(root);
    expect(lits(r)).toEqual(["src/S.tsx:2 radius 4", "src/S.tsx:2 z-index 999", "src/S.tsx:3 shadow 0 4px 8px rgba(0,0,0,.2)"]);
    expect(r.json.tokenValues.map((t: any) => `${t.line} ${t.literal}`)).toEqual(["3 rgba(229, 83, 61, 1)"]);
  });

  it("lists a new color defined as a custom property or Sass/Less variable, since no token has that value", () => {
    const root = project({
      ".aidw/design/tokens.yaml": TOKENS,
      "src/tokens.css": ":root { --x: #888888; --accent: #e5533d; }\n",
      "src/a.scss": "$brand: #777777;\n.a { color: $brand; padding: 5px; }\n",
      "src/b.less": "@brand: #666666;\n",
    });
    const r = tok(root);
    expect(lits(r)).toEqual(["src/a.scss:1 color #777777", "src/a.scss:2 length 5px", "src/b.less:1 color #666666", "src/tokens.css:1 color #888888"]);
    expect(r.json.tokenValues).toEqual([]);
  });

  it("BUG: hsl(var(--x)) and oklch(var(--l) var(--c) var(--h)) are derived from tokens, not color literals (shadcn/ui themes)", () => {
    const root = project({
      ".aidw/design/tokens.yaml": TOKENS,
      "src/globals.css": [
        ".btn { background-color: hsl(var(--primary)); color: hsl(var(--primary-foreground) / 0.9); }",
        ".x { border-color: oklch(var(--l) var(--c) var(--h)); background: rgb(var(--accent-rgb) / 0.5); }",
      ].join("\n"),
      "src/B.tsx": "export const B = () => <div style={{ color: 'hsl(var(--primary))' }} />;\n",
    });
    expect(lits(tok(root))).toEqual([]);
  });

  it("BUG: an in-page anchor whose name is hex letters (href=\"#cafe\", '#facade') is not a color", () => {
    const root = project({ "src/L.tsx": "export const L = () => <><a href=\"#cafe\">Café</a><a href=\"#facade\">Facade</a></>;\n" });
    expect(lits(tok(root))).toEqual([]);
  });
});

// ---------------------------------------------------------------- public-env-scan

describe("public-env-scan on realistic env reads", () => {
  it("reads destructured env and bracket access; a run-time key, an alias and a string are not seen", () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { vite: "5", react: "18" } }),
      "src/env.ts": [
        "const { VITE_API_URL, VITE_SENTRY_DSN: dsn, DB_URL = 'x' } = import.meta.env;",
        "const key = 'VITE_X';",
        "const dyn = import.meta.env[key];",
        "const env = import.meta.env; const aliased = env.VITE_ALIASED;",
        "const br = import.meta.env['VITE_BRACKET'];",
        "const msg = 'import.meta.env.VITE_IN_STRING';",
      ].join("\n"),
    });
    const r = env(root);
    expect(r.json.reads.map((x: any) => `${x.line} ${x.name} ${x.public}`)).toEqual(["1 DB_URL false", "1 VITE_API_URL true", "1 VITE_SENTRY_DSN true", "5 VITE_BRACKET true"]);
    // A DSN is meant for the browser (F10's list has no DSN word).
    expect(r.json.secretLooking).toEqual([]);
  });

  it("counts every file under src/ of a Vite SPA as client code (spec section 5), but not *.server.* files", () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { vite: "5", react: "18" } }),
      "src/main.tsx": "export const u = import.meta.env.VITE_URL;\n",
      "src/server/secrets.ts": "export const s = process.env.STRIPE_SECRET_KEY;\nexport const p = import.meta.env.VITE_PRIVATE_TOKEN;\n",
      "src/api/client.ts": "export const h = process.env.API_KEY;\n",
      "src/routes.server.ts": "export const r = process.env.SERVER_ONLY;\n",
    });
    const r = env(root);
    expect(r.json.clientFiles).toBe(3);
    expect(r.json.reads.map((x: any) => `${x.file} ${x.name} ${x.public}`)).toEqual(["src/api/client.ts API_KEY false", "src/main.tsx VITE_URL true", "src/server/secrets.ts STRIPE_SECRET_KEY false", "src/server/secrets.ts VITE_PRIVATE_TOKEN true"]);
    expect(r.json.secretLooking).toEqual([{ name: "VITE_PRIVATE_TOKEN", file: "src/server/secrets.ts", line: 2 }]);
  });

  it("never opens .env or .env.local, and reads .env.example (CRLF, commented, export) for names only", () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { vite: "5", react: "18" } }),
      ".env": "VITE_SECRET_KEY=abc\n",
      ".env.local": "VITE_LOCAL_TOKEN=abc\n",
      ".env.example": "VITE_PUBLIC_URL=x\r\n# VITE_ADMIN_PASSWORD=hunter2\r\nexport VITE_MAPBOX_TOKEN=pk.xyz\r\nVITE_SUPABASE_ANON_KEY=\r\n",
      "src/a.ts": "export const a = 1;\n",
    });
    for (const args of [[], ["--text"]]) {
      const r = env(root, args);
      expect(r.stdout).not.toMatch(/VITE_SECRET_KEY|VITE_LOCAL_TOKEN|hunter2|pk\.xyz/);
    }
    expect(env(root).json.secretLooking).toEqual([
      { name: "VITE_ADMIN_PASSWORD", file: ".env.example", line: 2 },
      { name: "VITE_MAPBOX_TOKEN", file: ".env.example", line: 3 },
    ]);
  });

  it("in Next.js reads process.env.NEXT_PUBLIC_X and destructured process.env in a client file; PUBLISHABLE is meant public", () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { next: "15" } }),
      "app/c.tsx": '"use client";\nconst a = process.env.NEXT_PUBLIC_API_URL;\nconst b = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;\nconst c = process.env.NEXT_PUBLIC_GITHUB_CLIENT_SECRET;\nconst { NEXT_PUBLIC_FOO, DATABASE_URL } = process.env;\n',
      "app/server.tsx": "const s = process.env.NEXT_PUBLIC_ADMIN_TOKEN;\n",
    });
    const r = env(root);
    expect(r.json.reads.map((x: any) => `${x.line} ${x.name} ${x.public}`)).toEqual([
      "2 NEXT_PUBLIC_API_URL true",
      "3 NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY true",
      "4 NEXT_PUBLIC_GITHUB_CLIENT_SECRET true",
      "5 DATABASE_URL false",
      "5 NEXT_PUBLIC_FOO true",
    ]);
    expect(r.json.secretLooking.map((x: any) => x.name)).toEqual(["NEXT_PUBLIC_ADMIN_TOKEN", "NEXT_PUBLIC_GITHUB_CLIENT_SECRET"]);
  });

  it("BUG: `import type` from a server-only module is erased at build time and is not a server import in client code", () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { next: "15" } }),
      "app/C.tsx": "'use client';\nimport type { User } from '@/server/db';\nexport const C = (u: User) => null;\n",
      "src/server/db.ts": "import 'server-only';\nexport type User = { id: string };\n",
    });
    expect(env(root).json.serverImportsInClient).toEqual([]);
  });
});

// ---------------------------------------------------------------- input edge cases

describe("frontend scripts on input edge cases", () => {
  const OLD = ['export const O = () => <div onClick={go} className="p-[13px]">x</div>;', ...Array.from({ length: 9 }, (_, i) => `export const v${i} = ${i};`)].join("\n") + "\n";
  const renamed = (): string => {
    const root = project({ "src/Old.tsx": OLD });
    gitBase(root);
    git(root, "mv", "src/Old.tsx", "src/New.tsx");
    appendFileSync(join(root, "src/New.tsx"), 'export const N = () => <span onClick={go} className="m-[7px]">y</span>;\n');
    write(root, { "src/Copy.tsx": 'export const C = () => <p onClick={go} className="gap-[9px]">z</p>;\n' });
    return root;
  };

  it("with --base after a git mv looks only at the lines added to the renamed file; an untracked file counts whole", () => {
    const root = renamed();
    expect(lits(tok(root, ["--base", "HEAD"]))).toEqual(["src/Copy.tsx:1 length gap-[9px]", "src/New.tsx:11 length m-[7px]"]);
    expect(probs(a11y(root, ["--base", "HEAD"]))).toEqual(["src/Copy.tsx:1 div-click p", "src/New.tsx:11 div-click span"]);
  });

  it("BUG: --base finds a renamed file's moved lines as not added whatever the user's diff.renames setting", () => {
    const root = renamed();
    // A user (or CI) with diff.renames=false: the script relies on git's config instead of passing -M.
    const noRenames = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "diff.renames", GIT_CONFIG_VALUE_0: "false" };
    const r = runScript(S("token-literals.mjs"), [root, "--base", "HEAD"], undefined, noRenames);
    expect(lits(r)).toEqual(["src/Copy.tsx:1 length gap-[9px]", "src/New.tsx:11 length m-[7px]"]);
  });

  it("gives the right line numbers for CRLF files", () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { vite: "5", react: "18" } }),
      "src/c.css": ".a {\r\n  color: #123456;\r\n  padding: 13px;\r\n}\r\n.b {\r\n  outline: none;\r\n}\r\n",
      "src/C.tsx": "export const C = () => (\r\n  <div\r\n    className=\"p-[13px]\"\r\n    style={{\r\n      margin: '7px',\r\n    }}\r\n    onClick={go}\r\n  >\r\n    <img src=\"a.png\" />\r\n  </div>\r\n);\r\nconst k = import.meta.env.VITE_AUTH_TOKEN;\r\n",
    });
    expect(lits(tok(root))).toEqual(["src/c.css:2 color #123456", "src/c.css:3 length 13px", "src/C.tsx:3 length p-[13px]", "src/C.tsx:5 length 7px"]);
    expect(probs(a11y(root))).toEqual(["src/c.css:6 outline-removed .b", "src/C.tsx:2 div-click div", "src/C.tsx:9 no-alt img"]);
    expect(env(root).json.reads).toEqual([{ file: "src/C.tsx", line: 12, name: "VITE_AUTH_TOKEN", public: true }]);
  });

  it("scans a valid file just under 512 KB in reasonable time and skips one over it", () => {
    // ~500 KB of real-looking markup (7 000 buttons), with one finding of each script at the very end.
    const rows = "  <button className=\"px-2 py-1 rounded\" onClick={save}>Save</button>\n".repeat(7000);
    const tail = "  <span onClick={go} className=\"p-[13px]\">last</span>\n</div>);\nexport const k = import.meta.env.API_KEY;\n";
    const big = `export const P = () => (<div>\n${rows}${tail}`;
    expect(big.length).toBeGreaterThan(480_000);
    expect(big.length).toBeLessThan(512 * 1024);
    const root = project({ "package.json": JSON.stringify({ dependencies: { vite: "5", react: "18" } }), "src/Big.tsx": big, "src/Huge.tsx": "export const H = 1;\n".repeat(30000) });
    for (const name of ["token-literals.mjs", "a11y-names.mjs", "public-env-scan.mjs"]) {
      const t = Date.now();
      const r = runScript(S(name), [root]);
      expect(r.code, name).toBe(0);
      expect(Date.now() - t, name).toBeLessThan(10_000);
      expect(r.json.skipped, name).toEqual([{ file: "src/Huge.tsx", reason: "larger than 512 KB" }]);
    }
    expect(lits(tok(root))).toEqual(["src/Big.tsx:7002 length p-[13px]"]);
    expect(probs(a11y(root))).toEqual(["src/Big.tsx:7002 div-click span"]);
    expect(env(root).json.reads).toEqual([{ file: "src/Big.tsx", line: 7004, name: "API_KEY", public: false }]);
  }, 60_000);

  it("does not crash on syntax it cannot parse, and still scans the other files", () => {
    const files = {
      "package.json": JSON.stringify({ dependencies: { vite: "5", react: "18" } }),
      "src/Unbalanced.tsx": "export const U = () => (\n  <div style={{ color: '#123456' }\n    <img src=\"x.png\" >\n  </div\n}}}}((((\n",
      "src/Bin.tsx": "\u0000\u0001\u0002<div onClick={x}>�",
      "src/Ok.tsx": "export const K = () => <div onClick={go} style={{ margin: '7px' }}>x</div>;\nconst v = import.meta.env.API_KEY;\n",
      "src/bad.css": ".a { color: #123456\n.b { outline: none\n@media (x { .c { padding: 13px }\n",
    };
    const root = project(files);
    for (const name of ["token-literals.mjs", "a11y-names.mjs", "public-env-scan.mjs"]) {
      const r = runScript(S(name), [root]);
      expect(r.code, name).toBe(0);
      expect(r.stderr, name).toBe("");
    }
    expect(lits(tok(root))).toContain("src/Ok.tsx:1 length 7px");
    expect(probs(a11y(root))).toContain("src/Ok.tsx:1 div-click div");
    expect(env(root).json.reads.map((x: any) => `${x.file} ${x.name}`)).toEqual(["src/Ok.tsx API_KEY"]);
  });

  it("BUG: a file whose template literal never closes is listed in skipped, not silently half-read", () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { vite: "5", react: "18" } }),
      "src/Broken.tsx": "const a = `oops\nconst k = import.meta.env.VITE_SECRET_TOKEN;\n",
    });
    // Today the read after the unclosed backtick is taken as string text: no read, no secretLooking, nothing skipped.
    const r = env(root);
    expect(r.json.skipped.map((s: any) => s.file)).toEqual(["src/Broken.tsx"]);
  });

  it("BUG: a file of HTML built in strings (unclosed <li>, <br>) under 512 KB is scanned in a few seconds at most", () => {
    const body = 'let html = "";\n' + 'html += "<li>" + item + "<br>";\n'.repeat(16000);
    const root = project({ "src/legacy.js": body });
    const t = Date.now();
    const r = a11y(root);
    expect(r.code).toBe(0);
    // A valid file of the same size takes about half a second; each unclosed tag scans 50 000 characters for its close.
    expect(Date.now() - t).toBeLessThan(2_500);
  }, 120_000);
});

// ---------------------------------------------------------------- the move of _common.mjs to library/scripts/

describe("library/scripts/_common.mjs after the move", () => {
  it("every backend and frontend script runs from the plugin copy a level 2 session gets", () => {
    const into = join(mkdtempSync(join(tmpdir(), "aidw-l2copy-")), "plugin");
    temps.push(join(into, ".."));
    copyPluginForSession(PLUGIN, into);
    expect(existsSync(join(into, "library", "scripts", "_common.mjs"))).toBe(true);
    expect(existsSync(join(into, "roles", "backend", "scripts", "_common.mjs"))).toBe(false);
    expect(existsSync(join(into, "roles", "backend", "evals"))).toBe(false);
    const root = project({
      "package.json": JSON.stringify({ dependencies: { vite: "5", express: "4" } }),
      ".env.example": "PORT=3000\n",
      "src/server.ts": "import express from 'express';\nconst app = express();\napp.get('/health', (req, res) => res.send(process.env.PORT));\n",
      "src/App.tsx": "export const A = () => <div onClick={go} className=\"p-[13px]\" />;\n",
      "q.log": "SELECT 1\n",
    });
    const run = (role: string, name: string, args: string[]) => runScript(join(into, "roles", role, "scripts", name), args);
    for (const name of readdirSync(join(into, "roles", "backend", "scripts")).filter((f) => !f.startsWith("_"))) {
      expect(run("backend", name, ["--help"]).code, name).toBe(0);
      const args = name === "query-count.mjs" ? ["--log", join(root, "q.log")] : [root];
      const r = run("backend", name, args);
      expect(r.stderr, name).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find module/);
      expect(r.code, `${name}: ${r.stderr}`).toBe(0);
      expect(r.json, name).toMatchObject({ tool: name.replace(".mjs", ""), schemaVersion: 1 });
    }
    for (const name of ["token-literals.mjs", "a11y-names.mjs", "public-env-scan.mjs"]) {
      const r = run("frontend", name, [root]);
      expect(r.code, `${name}: ${r.stderr}`).toBe(0);
      expect(r.json, name).toMatchObject({ tool: name.replace(".mjs", ""), schemaVersion: 1 });
    }
    expect(run("backend", "route-inventory.mjs", [root]).json.routes.map((x: any) => `${x.method} ${x.path}`)).toEqual(["GET /health"]);
  });

  it("no script imports a _common.mjs other than library/scripts/'s", () => {
    for (const role of ["backend", "frontend"]) {
      const dir = join(PLUGIN, "roles", role, "scripts");
      expect(existsSync(join(dir, "_common.mjs")), role).toBe(false);
      for (const f of readdirSync(dir)) {
        const src = readFileSync(join(dir, f), "utf8");
        for (const m of src.matchAll(/from\s+["']([^"']*_common\.mjs)["']/g)) expect(m[1], `${role}/${f}`).toBe("../../../library/scripts/_common.mjs");
      }
    }
  });

  it("a change to library/scripts/ leaves level 1's shared digest alone and changes level 2's working digest of a Role with scripts", () => {
    const root = mkdtempSync(join(tmpdir(), "aidw-digest-"));
    temps.push(root);
    cpSync(PLUGIN, root, { recursive: true, filter: (src) => !src.startsWith(join(PLUGIN, "bin")) });
    const ROLES = ["backend", "frontend", "database"] as const; // database has no scripts
    expect(existsSync(join(root, "roles", "database", "scripts"))).toBe(false);
    const one = (r: string) => ({ shared: sharedDigest(root, r), working: workingDigest(root, r) });
    const take = () => ({ backend: one("backend"), frontend: one("frontend"), database: one("database") });
    const before = take();
    appendFileSync(join(root, "library", "scripts", "_common.mjs"), "// a helper fix\n");
    const after = take();
    for (const r of ROLES) expect(after[r].shared, r).toBe(before[r].shared);
    expect(after.backend.working).not.toBe(before.backend.working);
    expect(after.frontend.working).not.toBe(before.frontend.working);
    expect(after.database.working).toBe(before.database.working);
    // A frontend-only helper changes frontend's working digest only.
    writeFileSync(join(root, "roles", "frontend", "scripts", "_markup.mjs"), "export {};\n");
    const third = take();
    expect(third.frontend.working).not.toBe(after.frontend.working);
    expect(third.backend.working).toBe(after.backend.working);
    for (const r of ROLES) expect(third[r].shared, r).toBe(before[r].shared);
  });
});

// ---------------------------------------------------------------- regressions of the review findings

describe("review fixes: public-env-scan", () => {
  it("M2a: vite in the devDependencies only for vitest does not make a backend's src/ client code", () => {
    const backend = project({
      "package.json": JSON.stringify({ dependencies: { express: "4" }, devDependencies: { vite: "5", vitest: "2" } }),
      "src/db.ts": "export const u = process.env.DATABASE_URL;\n",
    });
    expect(env(backend).json).toMatchObject({ framework: "none", clientFiles: 0, reads: [] });
    const spa = project({
      "package.json": JSON.stringify({ devDependencies: { vite: "5" } }),
      "index.html": "<div id=root></div>\n",
      "vite.config.ts": "export default {};\n",
      "src/main.ts": "export const u = import.meta.env.VITE_URL;\n",
    });
    expect(env(spa).json).toMatchObject({ framework: "vite", clientFiles: 1 });
    for (const lib of ["react", "vue", "svelte", "preact"]) {
      const r = project({ "package.json": JSON.stringify({ dependencies: { [lib]: "1" }, devDependencies: { vite: "5" } }), "src/a.ts": "export const a = 1;\n" });
      expect(env(r).json.framework, lib).toBe("vite");
    }
  });

  it("M2c: a .js specifier reaches the .ts or .tsx file (TypeScript ESM style)", () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { next: "15" } }),
      "app/C.tsx": "'use client';\nimport { a } from './util.js';\nimport { B } from './B.js';\nexport const C = () => a + B;\n",
      "app/util.ts": "export const a = process.env.UTIL_VALUE;\n",
      "app/B.tsx": "export const B = process.env.B_VALUE;\n",
    });
    const r = env(root).json;
    expect(r.clientFiles).toBe(3);
    expect(r.reads.map((x: any) => x.name)).toEqual(["B_VALUE", "UTIL_VALUE"]);
  });

  it("M2: Remix, React Router framework mode and TanStack Start are reported as unsupported, exit 0", () => {
    for (const dep of ["@remix-run/react", "@react-router/dev", "@tanstack/react-start"]) {
      const root = project({ "package.json": JSON.stringify({ dependencies: { react: "19", [dep]: "1" }, devDependencies: { vite: "5" } }), "app/routes/a.tsx": "export const a = process.env.X;\n" });
      const r = env(root);
      expect(r.code, dep).toBe(0);
      expect(r.json.framework, dep).toBe("none");
      expect(r.json.skipped.map((s: any) => s.file), dep).toEqual(["package.json"]);
      expect(r.json.skipped[0].reason, dep).toMatch(/not supported/);
    }
  });

  it("L5: DSN and AUTH alone are not secret words; KEY, SECRET, TOKEN, PASSWORD and PRIVATE are", () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { vite: "5", react: "18" } }),
      "src/a.ts": [
        "const a = import.meta.env.VITE_SENTRY_DSN;",
        "const b = import.meta.env.VITE_AUTH_DOMAIN;",
        "const c = import.meta.env.VITE_AUTH0_CLIENT_ID;",
        "const d = import.meta.env.VITE_API_KEY;",
        "const e = import.meta.env.VITE_DB_PASSWORD;",
        "const f = import.meta.env.VITE_PRIVATE_URL;",
        "const g = import.meta.env.VITE_AUTH_TOKEN;",
      ].join("\n"),
    });
    expect(env(root).json.secretLooking.map((x: any) => x.name)).toEqual(["VITE_API_KEY", "VITE_AUTH_TOKEN", "VITE_DB_PASSWORD", "VITE_PRIVATE_URL"]);
  });

  it("import { type A } with only type specifiers is erased too", () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { next: "15" } }),
      "app/C.tsx": "'use client';\nimport { type User } from '@/server/db';\nexport type { User } from '@/server/db';\nexport const C = 1;\n",
      "src/server/db.ts": "import 'server-only';\nexport type User = { id: string };\n",
    });
    expect(env(root).json.serverImportsInClient).toEqual([]);
  });
});

describe("review fixes: a11y-names", () => {
  const names = (body: string) => probs(a11y(project({ "src/A.tsx": `import { Gear } from 'lucide-react';\nexport const A = () => (\n<>\n${body}\n</>\n);\n` })));

  it("M3: IconButton and Iconography are not icons; *Icon and a library import are; <i> needs to be empty or without text", () => {
    expect(names([
      "<button><IconButton /></button>",
      "<button><Iconography /></button>",
      "<button><SearchIcon /></button>",
      "<button><Gear /></button>",
      "<button><i>Save</i></button>",
      '<button><i className="fa fa-x"></i></button>',
      "<button><i /></button>",
      "<button><Icon /></button>",
    ].join("\n"))).toEqual(["src/A.tsx:6 no-name button", "src/A.tsx:7 no-name button", "src/A.tsx:9 no-name button", "src/A.tsx:10 no-name button", "src/A.tsx:11 no-name button"]);
  });

  it("L1: x, X, the multiplication sign and &times; alone are a symbol, not a name", () => {
    const r = a11y(project({ "src/A.tsx": "export const A = () => (<>\n<button>x</button>\n<button>X</button>\n<button>×</button>\n<button>&times;</button>\n<button>Xbox</button>\n<button>Close</button>\n</>);\n" }));
    expect(probs(r)).toEqual(["src/A.tsx:2 no-name button", "src/A.tsx:3 no-name button", "src/A.tsx:4 no-name button", "src/A.tsx:5 no-name button"]);
    expect(r.json.findings[0].detail).toMatch(/only a symbol/);
  });

  it("M4: a styled-components template with no outer block is one scope for :focus-visible", () => {
    const root = project({
      "src/S.tsx": [
        "import styled, { css } from 'styled-components';",
        "export const A = styled.button`",
        "  outline: none;",
        "  &:focus-visible { outline: 2px solid blue; }",
        "`;",
        "export const B = styled.button`",
        "  outline: none;",
        "  &:hover { color: red; }",
        "`;",
        "export const C = css`outline: 0; &:focus-visible { box-shadow: 0 0 0 2px blue; }`;",
      ].join("\n"),
    });
    expect(probs(a11y(root))).toEqual(["src/S.tsx:7 outline-removed null"]);
  });

  it("a <Label> and a <FormLabel> bind and wrap a field like a <label>", () => {
    const root = project({ "src/F.tsx": "export const F = () => (<>\n<FormLabel>Name<input /></FormLabel>\n<Label htmlFor=\"a\">A</Label><input id=\"a\" />\n<Label htmlFor=\"zzz\">Z</Label><input id=\"b\" />\n</>);\n" });
    expect(probs(a11y(root))).toEqual(["src/F.tsx:4 no-label input"]);
  });

  it("a file with an unclosed template literal is skipped by all three scripts", () => {
    const root = project({ "package.json": JSON.stringify({ dependencies: { vite: "5", react: "18" } }), "src/B.tsx": "const a = `oops\n<div onClick={x} style={{ margin: '7px' }} />\n" });
    for (const r of [a11y(root), tok(root), env(root)]) {
      expect(r.json.skipped).toEqual([{ file: "src/B.tsx", reason: expect.stringMatching(/unclosed template literal/) }]);
      expect(r.json.findings ?? []).toEqual([]);
    }
  });

  it("//: a URL or a comment-like text inside JSX text is text; a real trailing comment is still a comment", () => {
    const root = project({
      "src/U.tsx": [
        "import { X } from 'lucide-react';",
        "export const U = () => (<>",
        "<p>a // b</p><button><X /></button>",
        "<br /> <button><X /></button> // trailing <button><X /></button>",
        "</>);",
      ].join("\n"),
    });
    expect(probs(a11y(root))).toEqual(["src/U.tsx:3 no-name button", "src/U.tsx:4 no-name button"]);
  });

  it("closing tags are found for nested same-name elements and a long file of unclosed tags stays linear", () => {
    const root = project({ "src/N.tsx": "export const N = () => (<>\n<button><button>ok</button></button>\n<a href=\"/x\"><a href=\"/y\"><svg /></a></a>\n</>);\n" });
    expect(probs(a11y(root))).toEqual(["src/N.tsx:3 no-name a"]);
  });
});

describe("review fixes: token-literals", () => {
  it("M5: a bare number in sx is not px, and SVG and clamp properties are unitless", () => {
    const root = project({
      ".aidw/design/tokens.yaml": TOKENS,
      "src/M.tsx": [
        "export const M = () => (<>",
        "<Box sx={{ p: 2, m: 3, width: 240, borderRadius: 2, zIndex: 999, mt: '13px' }} />",
        "<p style={{ strokeWidth: 2, WebkitLineClamp: 3, fillOpacity: 0.5, strokeOpacity: 1, columnCount: 2, flexShrink: 0, order: 2, zoom: 2 }} />",
        "</>);",
      ].join("\n"),
    });
    expect(lits(tok(root))).toEqual(["src/M.tsx:2 length 13px", "src/M.tsx:2 z-index 999"]);
  });

  it("L7: white and black written as hsl() or oklch() are allowed; other colors in those forms are not", () => {
    const root = project({
      ".aidw/design/tokens.yaml": TOKENS,
      "src/a.css": [
        ".a { color: hsl(0 0% 100%); background: hsl(0, 0%, 0%); border-color: oklch(1 0 0); outline-color: oklch(0 0 0); }",
        ".b { color: hsl(0 0% 50%); background: oklch(0.7 0.1 30); }",
      ].join("\n"),
    });
    expect(lits(tok(root))).toEqual(["src/a.css:2 color hsl(0 0% 50%)", "src/a.css:2 color oklch(0.7 0.1 30)"]);
  });

  it("L3: a declaration right after a closing } is read", () => {
    const root = project({ ".aidw/design/tokens.yaml": TOKENS, "src/n.scss": ".a { .b { color: var(--x); } padding: 13px; &:hover { margin: 5px } width: 7px; }\n" });
    expect(lits(tok(root))).toEqual(["src/n.scss:1 length 13px", "src/n.scss:1 length 5px", "src/n.scss:1 length 7px"]);
  });

  it("hex strings: color-like names count, anchors and selectors do not", () => {
    const root = project({
      "src/h.ts": [
        "const accent = '#abcdef';",
        "ctx.fillStyle = '#123456';",
        "setColor('#654321');",
        "document.querySelector('#facade');",
        "const link = '#cafe';",
      ].join("\n"),
    });
    expect(lits(tok(root))).toEqual(["src/h.ts:1 color #abcdef", "src/h.ts:2 color #123456", "src/h.ts:3 color #654321"]);
  });

  it("L6: inline or flow tokens: exits 2 with a message; 0 tokens from a non-empty file is noted in skipped", () => {
    const flow = project({ ".aidw/design/tokens.yaml": 'tokens: [{ name: a, kind: color, value: "#111111" }]\n', "src/a.css": ".a { color: #222222 }\n" });
    const r = tok(flow);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/inline or flow/);
    const empty = project({ ".aidw/design/tokens.yaml": "tokens:\n  - name: a\n    kind: color\n", "src/a.css": ".a { color: #222222 }\n" });
    const e = tok(empty);
    expect(e.code).toBe(0);
    expect(e.json.tokens).toBe(0);
    expect(e.json.skipped).toEqual([{ file: ".aidw/design/tokens.yaml", reason: expect.stringMatching(/0 tokens parsed/) }]);
    expect(tok(project({ ".aidw/design/tokens.yaml": "tokens: []\n" })).json.skipped).toEqual([]);
  });

  it("N2: an absolute --tokens path is used as is", () => {
    const elsewhere = project({ "t.yaml": TOKENS });
    const root = project({ "src/a.css": ".a { color: #e5533d; padding: 13px }\n" });
    const r = tok(root, ["--tokens", join(elsewhere, "t.yaml")]);
    expect(r.code).toBe(0);
    expect(r.json.tokens).toBe(6);
    expect(r.json.tokenValues.map((t: any) => t.token)).toEqual(["accent"]);
  });
});
