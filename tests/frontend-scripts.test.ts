import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemps, gitBase, project, roleScript, runScript, write } from "./rolescripts.js";

// The frontend Role's measuring tools (plan R1, T20): dependency-free Node scripts, advisory, JSON by default.
const S = (name: string) => roleScript("frontend", name);
afterAll(cleanTemps);

const SCRIPTS = ["token-literals.mjs", "a11y-names.mjs", "public-env-scan.mjs"];
const DIR = join(__dirname, "..", "plugins", "aidw", "roles", "frontend", "scripts");

describe("every frontend script", () => {
  it("is one of the three, prints --help with exit 0, refuses an unknown option with exit 2", () => {
    expect(readdirSync(DIR).filter((f) => !f.startsWith("_")).sort()).toEqual([...SCRIPTS].sort());
    for (const name of SCRIPTS) {
      const help = runScript(S(name), ["--help"]);
      expect(help.code, name).toBe(0);
      expect(help.stdout, name).toMatch(/Usage:/);
      expect(help.stdout, name).toMatch(/Limits:/);
      const bad = runScript(S(name), ["--no-such-option"]);
      expect(bad.code, name).toBe(2);
      expect(bad.stderr, name).toMatch(/--help/);
    }
  });

  it("imports only node built-ins, its own helpers and the shared ones, and documents its usage at the top", () => {
    for (const f of readdirSync(DIR)) {
      const src = readFileSync(join(DIR, f), "utf8");
      for (const m of src.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)) expect(m[1], `${f}: ${m[1]}`).toMatch(/^(node:|\.\/_|\.\.\/\.\.\/\.\.\/library\/scripts\/_)/);
      if (!f.startsWith("_")) expect(src.slice(0, 2000), f).toMatch(/Usage:/);
    }
  });

  it("exits 2 on a directory that does not exist and on a base ref git does not know, and heads its JSON", () => {
    const root = project({ "src/a.tsx": "export const A = () => <div />;\n" });
    gitBase(root);
    for (const name of SCRIPTS) {
      expect(runScript(S(name), ["/no/such/dir/anywhere"]).code, name).toBe(2);
      expect(runScript(S(name), [root, "--base", "no-such-ref"]).code, name).toBe(2);
      const r = runScript(S(name), [root]);
      expect(r.code, name).toBe(0);
      expect(r.json, name).toMatchObject({ tool: name.replace(".mjs", ""), schemaVersion: 1, skipped: [] });
    }
  });

  it("lists in skipped what it did not read", () => {
    const root = project({ "src/a.tsx": "export const A = 1;\n", "public/x.js": "a\n", "src/vendor.min.js": "a\n" });
    for (const name of SCRIPTS) {
      const files = runScript(S(name), [root]).json.skipped.map((s: any) => s.file);
      expect(files, name).toEqual(["public/", "src/vendor.min.js"]);
    }
  });
});

const TOKENS = [
  "tokens:",
  "  - name: accent   # the one warm color",
  "    kind: color",
  '    value: "#E5533D"',
  '    dark: "#FF7A66"',
  "    use: Start button and links",
  "  - name: space-2",
  "    kind: space",
  "    value: 8px",
  "    use: gaps inside a card",
  "  - name: space-4",
  "    kind: space",
  "    value: 1rem",
  "    use: gaps between cards",
  "  - name: radius-md",
  "    kind: radius",
  "    value: 6px",
  "    use: cards and inputs",
  "  - name: body",
  "    kind: font",
  '    value: "Inter, sans-serif"',
  "    use: all body text",
  '  - { name: card-shadow, kind: shadow, value: "0 1px 2px rgba(0, 0, 0, 0.1)", use: cards everywhere }',
  "  - name: z-modal",
  "    kind: other",
  "    value: 50",
  "    use: the modal layer",
].join("\n");

describe("token-literals", () => {
  const files = {
    ".aidw/design/tokens.yaml": TOKENS,
    "src/app.css": [
      ":root { --accent: #e5533d; --brand-new: #123456; }",
      ".card { color: #e5533d; padding: 13px 16px; border-radius: 7px; box-shadow: 0 1px 2px rgba(0,0,0,.1); }",
      ".title { font-family: 'Roboto', sans-serif; z-index: 60; margin: 0; border: 1px solid var(--line); }",
      ".ok { padding: var(--space-2); color: color-mix(in srgb, var(--accent) 80%, white); font-family: system-ui; }",
      "/* color: #abcdef */",
      ".named { color: tomato; background: #fff; }",
      "@media (min-width: 768px) { .x { gap: calc(var(--space-2) * 2); } }",
    ].join("\n"),
    "src/Card.tsx": [
      "export function Card() {",
      "  return (",
      "    <div className=\"p-[13px] bg-[#e5533d] hover:text-[#111111] rounded-[6px] z-[60] font-['Roboto'] shadow-[0_2px_4px_#00000033] grid-cols-[1fr_2fr] p-4\"",
      "      style={{ padding: 12, marginTop: '24px', color: '#ff0000', zIndex: 50, opacity: 0.5, gap: 'var(--space-2)' }}>",
      "      <svg fill=\"#22aa22\" />",
      "    </div>",
      "  );",
      "}",
      "const Box = styled.div`",
      "  gap: ${(p) => p.gap}px;",
      "  margin: 20px;",
      "  color: rgb(1, 2, 3);",
      "`;",
      "const theme = { brand: '#abcabc' };",
      "// <div className=\"p-[99px]\" />",
    ].join("\n"),
    "src/Card.test.tsx": "render(<div style={{ color: '#010101' }} />);\n",
    "tailwind.config.js": "module.exports = { theme: { colors: { accent: '#e5533d' } } };\n",
  };

  it("lists literals that are not a token by kind, with the nearest token", () => {
    const root = project(files);
    const r = runScript(S("token-literals.mjs"), [root]);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ tokensFile: ".aidw/design/tokens.yaml", tokens: 7, base: null });
    const got = r.json.findings.map((f: any) => `${f.file}:${f.line} ${f.kind} ${f.literal}${f.nearestToken ? ` ~${f.nearestToken.name}` : ""}`);
    expect(got).toEqual([
      "src/app.css:1 color #123456 ~accent",
      "src/app.css:2 length 13px ~space-4",
      "src/app.css:2 radius 7px ~radius-md",
      "src/app.css:3 font 'Roboto', sans-serif ~body",
      "src/app.css:3 z-index 60 ~z-modal",
      "src/Card.tsx:3 color text-[#111111] ~accent",
      "src/Card.tsx:3 length p-[13px] ~space-4",
      "src/Card.tsx:3 font font-['Roboto'] ~body",
      "src/Card.tsx:3 shadow shadow-[0_2px_4px_#00000033] ~card-shadow",
      "src/Card.tsx:3 z-index z-[60] ~z-modal",
      "src/Card.tsx:4 color #ff0000 ~accent",
      "src/Card.tsx:4 length 12 ~space-2",
      "src/Card.tsx:4 length 24px ~space-4",
      "src/Card.tsx:5 color #22aa22 ~accent",
      "src/Card.tsx:11 length 20px ~space-4",
      "src/Card.tsx:12 color rgb(1, 2, 3) ~accent",
      "src/Card.tsx:14 color #abcabc ~accent",
    ]);
    const tw = r.json.findings.find((f: any) => f.literal === "p-[13px]");
    expect(tw.value).toBe("13px");
  });

  it("lists a token's value written in place, but not where a token is defined", () => {
    const root = project(files);
    const r = runScript(S("token-literals.mjs"), [root]);
    expect(r.json.tokenValues.map((t: any) => `${t.file}:${t.line} ${t.literal} ${t.token}`)).toEqual([
      "src/app.css:2 #e5533d accent",
      "src/app.css:2 16px space-4",
      "src/app.css:2 0 1px 2px rgba(0,0,0,.1) card-shadow",
      "src/Card.tsx:3 bg-[#e5533d] accent",
      "src/Card.tsx:3 rounded-[6px] radius-md",
      "src/Card.tsx:4 50 z-modal",
    ]);
  });

  it("with --base looks only at the lines the diff adds", () => {
    const root = project(files);
    gitBase(root);
    write(root, { "src/app.css": `${files["src/app.css"]}\n.new { padding: 14px; color: #e5533d; }\n`, "src/New.tsx": "export const N = () => <p className=\"mt-[3px]\" />;\n" });
    const r = runScript(S("token-literals.mjs"), [root, "--base", "HEAD"]);
    expect(r.json.base).toBe("HEAD");
    expect(r.json.findings.map((f: any) => `${f.file}:${f.line} ${f.literal}`)).toEqual(["src/app.css:8 14px", "src/New.tsx:1 mt-[3px]"]);
    expect(r.json.tokenValues.map((t: any) => t.literal)).toEqual(["#e5533d"]);
  });

  it("without a tokens file lists every literal; --tokens names another file; a missing or malformed one exits 2", () => {
    const root = project({ "src/a.css": ".a { color: #e5533d; padding: 8px; }\n", "design/t.yaml": TOKENS, "bad.yaml": "colors:\n  - red\n" });
    const none = runScript(S("token-literals.mjs"), [root]);
    expect(none.json).toMatchObject({ tokensFile: null, tokens: 0 });
    expect(none.json.findings.map((f: any) => f.literal)).toEqual(["#e5533d", "8px"]);
    expect(none.json.findings[0].nearestToken).toBeUndefined();
    const other = runScript(S("token-literals.mjs"), [root, "--tokens", "design/t.yaml"]);
    expect(other.json.findings).toEqual([]);
    expect(runScript(S("token-literals.mjs"), [root, "--tokens", "nope.yaml"]).code).toBe(2);
    const bad = runScript(S("token-literals.mjs"), [root, "--tokens", "bad.yaml"]);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/tokens:/);
  });

  it("prints a table with --text", () => {
    const root = project(files);
    const r = runScript(S("token-literals.mjs"), [root, "--text"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^tokens: 7 from \.aidw\/design\/tokens\.yaml/);
    expect(r.stdout).toMatch(/src\/app\.css:2\s+length\s+13px\s+space-4 \(1rem\)/);
    expect(r.stdout).toMatch(/token values written in place \(6\)/);
  });

  it("limits: color names, plain objects other than style and sx, and comments are not read", () => {
    const root = project({ "src/a.tsx": "const s = { padding: 13 };\nconst c = 'red';\n// '#123456'\nexport const A = () => <div sx={{ m: '7px' }} />;\n" });
    const r = runScript(S("token-literals.mjs"), [root]);
    expect(r.json.findings.map((f: any) => f.literal)).toEqual(["7px"]);
  });
});

describe("a11y-names", () => {
  const page = [
    'import { X } from "lucide-react";',
    'import Link from "next/link";',
    "export function Page({ items, html, props }) {",
    "  return (",
    "    <main>",
    "      <div onClick={() => go()}>Open</div>",
    "      <div role=\"button\" tabIndex={0} onClick={go} onKeyDown={key}>ok</div>",
    "      <a onClick={go}>no href</a>",
    "      <button onClick={close}><X /></button>",
    "      <button aria-label=\"Close\"><X /></button>",
    "      <button>×</button>",
    "      <button>Save</button>",
    "      <button><span className=\"sr-only\">Close</span><X /></button>",
    "      <Link href=\"/home\"><HomeIcon /></Link>",
    "      <input type=\"text\" />",
    "      <input id=\"email\" />",
    "      <label htmlFor=\"email\">Email</label>",
    "      <label>Name <input /></label>",
    "      <input type=\"hidden\" name=\"t\" />",
    "      <input aria-label=\"Search\" />",
    "      <img src=\"a.png\" />",
    "      <img src=\"b.png\" alt=\"\" />",
    "      <div tabIndex={2}>x</div>",
    "      <div dangerouslySetInnerHTML={{ __html: html }} />",
    "      <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />",
    "      <button className=\"outline-none px-2\">Go</button>",
    "      <button className=\"focus-visible:ring-2 outline-none\">Go</button>",
    "      <Foo {...props} onClick={go} />",
    "      <div {...props} onClick={go} />",
    "      <p>Don't stop</p>",
    "      {items.length < 3 && <span>few</span>}",
    "      <select><option>a</option></select>",
    "      <button>{t('close')}</button>",
    "      {/* <img src=\"c.png\" /> */}",
    "    </main>",
    "  );",
    "}",
    "el.innerHTML = userText;",
    'const s = "el.innerHTML = x";',
  ].join("\n");
  const css = "button:focus { outline: none; }\n.a:focus-visible { outline: 2px solid; }\n.b { outline: 0; }\n.c { &:focus { outline: none; } &:focus-visible { box-shadow: 0 0 0 2px; } }\n";

  it("finds unnamed controls, clickable divs, unlabelled fields, images without alt, tab order, outlines and raw HTML", () => {
    const root = project({ "src/Page.tsx": page, "src/app.scss": css, "src/Page.test.tsx": "<div onClick={go} />\n" });
    const r = runScript(S("a11y-names.mjs"), [root]);
    expect(r.code).toBe(0);
    expect(r.json.findings.map((f: any) => `${f.file}:${f.line} ${f.problem} ${f.element}`)).toEqual([
      "src/app.scss:1 outline-removed button:focus",
      "src/app.scss:3 outline-removed .b",
      "src/Page.tsx:6 div-click div",
      "src/Page.tsx:8 div-click a",
      "src/Page.tsx:9 no-name button",
      "src/Page.tsx:11 no-name button",
      "src/Page.tsx:14 no-name Link",
      "src/Page.tsx:15 no-label input",
      "src/Page.tsx:21 no-alt img",
      "src/Page.tsx:23 positive-tabindex div",
      "src/Page.tsx:24 raw-html div",
      "src/Page.tsx:26 outline-removed button",
      "src/Page.tsx:32 no-label select",
      "src/Page.tsx:38 raw-html innerHTML",
    ]);
    expect(r.json.findings[2].detail).toBe("onClick without role, tabIndex, key handler");
  });

  it("finds nothing on accessible markup", () => {
    const good = [
      "export const Good = ({ onPick }) => (",
      "  <form>",
      "    <button type=\"button\" aria-label=\"Close dialog\" onClick={onPick}><svg aria-hidden=\"true\" /></button>",
      "    <a href=\"/docs\">Documentation</a>",
      "    <label htmlFor=\"q\">Query</label><input id=\"q\" />",
      "    <textarea aria-labelledby=\"note-label\" />",
      "    <img src=\"logo.png\" alt=\"Acme\" />",
      "    <li role=\"option\" tabIndex={-1} onClick={onPick} onKeyDown={onPick}>One</li>",
      "    <button className=\"outline-none focus-visible:ring-2\">Go</button>",
      "  </form>",
      ");",
    ].join("\n");
    const root = project({ "src/Good.jsx": good, "src/a.css": ".x:focus-visible { outline: none; box-shadow: 0 0 0 2px; }\n" });
    expect(runScript(S("a11y-names.mjs"), [root]).json.findings).toEqual([]);
  });

  it("with --base looks only at the lines the diff adds", () => {
    const root = project({ "src/Page.tsx": page, "src/app.scss": css });
    gitBase(root);
    write(root, { "src/Page.tsx": page.replace("<main>", "<main>\n      <span onClick={go}>new</span>") });
    const r = runScript(S("a11y-names.mjs"), [root, "--base", "HEAD"]);
    expect(r.json.findings.map((f: any) => `${f.line} ${f.problem} ${f.element}`)).toEqual(["6 div-click span"]);
  });

  it("prints a table with --text", () => {
    const root = project({ "src/Page.tsx": page });
    const r = runScript(S("a11y-names.mjs"), [root, "--text"]);
    expect(r.stdout).toMatch(/^findings \(12\):/);
    expect(r.stdout).toMatch(/src\/Page\.tsx:9\s+no-name\s+button\s+content is empty or only an icon/);
  });

  it("limits: a component is not looked into, and an element given a spread is skipped", () => {
    const root = project({ "src/a.tsx": "export const A = (p) => <><IconButton onClick={go}><X /></IconButton><img {...p} /><input {...p} /></>;\n" });
    expect(runScript(S("a11y-names.mjs"), [root]).json.findings).toEqual([]);
  });
});

describe("public-env-scan", () => {
  it("in a Vite app lists client reads, secret-looking public names and server-only imports", () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { vite: "5", react: "19" } }),
      ".env.example": "VITE_API_URL=https://api.example.com\nVITE_STRIPE_SECRET_KEY=sk_live_value\nVITE_STRIPE_PUBLISHABLE_KEY=pk\nDATABASE_URL=postgres://u:p@h/db\n",
      ".env": "VITE_LEAKED=topsecret\n",
      "src/api.ts": [
        'import { db } from "./server/db";',
        'import { helper } from "@/lib/helper";',
        "const url = import.meta.env.VITE_API_URL;",
        "const k = import.meta.env.VITE_STRIPE_SECRET_KEY;",
        "const leak = process.env.DATABASE_URL;",
        "const mode = import.meta.env.MODE;",
        "// const c = import.meta.env.COMMENTED;",
      ].join("\n"),
      "src/server/db.ts": 'import "server-only";\nexport const db = process.env.DB_PASSWORD;\n',
      "src/lib/helper.ts": "export const helper = import.meta.env.API_TOKEN;\n",
      "server.ts": "export const x = process.env.SERVER_THING;\n",
      "src/api.test.ts": "process.env.TEST_ONLY;\n",
    });
    const r = runScript(S("public-env-scan.mjs"), [root]);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ framework: "vite", publicPrefix: ["VITE_"], clientFiles: 2 });
    expect(r.json.reads.map((x: any) => `${x.file}:${x.line} ${x.name} ${x.public}`)).toEqual([
      "src/api.ts:3 VITE_API_URL true",
      "src/api.ts:4 VITE_STRIPE_SECRET_KEY true",
      "src/api.ts:5 DATABASE_URL false",
      "src/lib/helper.ts:1 API_TOKEN false",
    ]);
    expect(r.json.secretLooking).toEqual([{ name: "VITE_STRIPE_SECRET_KEY", file: "src/api.ts", line: 4 }]);
    expect(r.json.serverImportsInClient).toEqual([{ file: "src/api.ts", line: 1, from: "./server/db" }]);
    for (const args of [[root], [root, "--text"]]) expect(runScript(S("public-env-scan.mjs"), args).stdout).not.toMatch(/sk_live|postgres:|topsecret|VITE_LEAKED/);
  });

  it("in Next.js takes 'use client' files and what they import as client code", () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { next: "15" } }),
      "app/page.tsx": "export default function P() { return process.env.SECRET_FROM_SERVER; }\n",
      "app/Widget.tsx": "'use client';\nimport { fmt } from '../lib/fmt';\nimport { q } from '../lib/data.server';\nimport 'server-only';\nconst a = process.env.NEXT_PUBLIC_MAP_TOKEN;\nconst b = process.env.STRIPE_KEY;\n",
      "lib/fmt.ts": "export const fmt = process.env.NEXT_PUBLIC_LOCALE ?? process.env.INTERNAL_FLAG;\n",
      "lib/data.server.ts": "export const q = 1;\n",
    });
    const r = runScript(S("public-env-scan.mjs"), [root]);
    expect(r.json).toMatchObject({ framework: "next", publicPrefix: ["NEXT_PUBLIC_"], clientFiles: 2 });
    expect(r.json.reads.map((x: any) => `${x.file} ${x.name} ${x.public}`)).toEqual([
      "app/Widget.tsx NEXT_PUBLIC_MAP_TOKEN true",
      "app/Widget.tsx STRIPE_KEY false",
      "lib/fmt.ts INTERNAL_FLAG false",
      "lib/fmt.ts NEXT_PUBLIC_LOCALE true",
    ]);
    expect(r.json.secretLooking.map((x: any) => x.name)).toEqual(["NEXT_PUBLIC_MAP_TOKEN"]);
    expect(r.json.serverImportsInClient.map((x: any) => x.from)).toEqual(["../lib/data.server", "server-only"]);
  });

  it("in SvelteKit reads $env imports and flags the private ones and $lib/server in client files", () => {
    const root = project({
      "package.json": JSON.stringify({ devDependencies: { "@sveltejs/kit": "2" } }),
      "src/routes/+page.ts": "import { PUBLIC_SITE } from '$env/static/public';\nimport { API_SECRET } from '$env/static/private';\nimport { db } from '$lib/server/db';\n",
      "src/routes/+page.server.ts": "import { API_SECRET } from '$env/static/private';\n",
      "src/lib/server/db.ts": "export const db = 1;\n",
    });
    const r = runScript(S("public-env-scan.mjs"), [root]);
    expect(r.json.framework).toBe("sveltekit");
    expect(r.json.reads.map((x: any) => `${x.file} ${x.name} ${x.public}`)).toEqual(["src/routes/+page.ts PUBLIC_SITE true", "src/routes/+page.ts API_SECRET false"]);
    expect(r.json.serverImportsInClient.map((x: any) => x.from)).toEqual(["$env/static/private", "$lib/server/db"]);
  });

  it("takes the framework from --framework and Vite's envPrefix from vite.config; refuses an unknown framework", () => {
    const root = project({
      "vite.config.ts": "export default { envPrefix: ['APP_', 'VITE_'] };\n",
      "src/a.ts": "import.meta.env.APP_URL; import.meta.env.OTHER;\n",
    });
    const r = runScript(S("public-env-scan.mjs"), [root, "--framework", "vite"]);
    expect(r.json.publicPrefix).toEqual(["APP_", "VITE_"]);
    expect(r.json.reads.map((x: any) => `${x.name} ${x.public}`)).toEqual(["APP_URL true", "OTHER false"]);
    expect(runScript(S("public-env-scan.mjs"), [root]).json).toMatchObject({ framework: "none", clientFiles: 0, reads: [] });
    expect(runScript(S("public-env-scan.mjs"), [root, "--framework", "remix"]).code).toBe(2);
  });

  it("with --base looks only at the lines the diff adds, but client files still come from the whole tree", () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { vite: "5" } }),
      "src/main.ts": "import { cfg } from './cfg';\nprocess.env.OLD_NAME;\n",
      "lib-outside.ts": "",
      "src/cfg.ts": "export const cfg = 1;\n",
    });
    gitBase(root);
    write(root, { "src/cfg.ts": "export const cfg = 1;\nexport const k = import.meta.env.VITE_AUTH_TOKEN ?? process.env.NEW_NAME;\n" });
    const r = runScript(S("public-env-scan.mjs"), [root, "--base", "HEAD"]);
    expect(r.json.reads.map((x: any) => x.name)).toEqual(["NEW_NAME", "VITE_AUTH_TOKEN"]);
    expect(r.json.secretLooking.map((x: any) => x.name)).toEqual(["VITE_AUTH_TOKEN"]);
  });

  it("prints short text with --text", () => {
    const root = project({ "package.json": JSON.stringify({ dependencies: { vite: "5" } }), "src/a.ts": "process.env.DB_URL;\n" });
    const r = runScript(S("public-env-scan.mjs"), [root, "--text"]);
    expect(r.stdout).toMatch(/^framework: vite; public prefix: VITE_; client files: 1/);
    expect(r.stdout).toMatch(/without the public prefix \(1\):\n {2}DB_URL {2}src\/a\.ts:1/);
  });

  it("limits: a name built at run time is not seen, and a Next.js file without 'use client' is not client code", () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { next: "15" } }),
      "pages/index.tsx": "export default () => process.env.SERVER_ONLY_NAME;\n",
      "app/c.tsx": "'use client';\nconst v = process.env[name];\n",
    });
    expect(runScript(S("public-env-scan.mjs"), [root]).json.reads).toEqual([]);
  });
});
