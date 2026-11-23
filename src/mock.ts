/**
 * Tools for a Design Mock (ADR-0008): open-licence fonts stored beside the mock, and screenshots of the mock in
 * the project's test browser so the Agent that built it can look at what it built.
 *
 * Fonts come from Fontsource, whose metadata names each family's licence: anything that is not OFL is refused, so
 * a mock never ships a font it may not redistribute. Downloads are cached under ~/.aidw/cache/fonts by family and
 * version; when that place cannot be written the font is downloaded without a cache.
 *
 * Screenshots need a real browser, and a Chrome cannot be launched from inside the Claude Code sandbox, so they
 * use the test browser of `aidw browser start` over CDP. The CLI is synchronous, so the CDP work runs in a child
 * process (`runShotsWorker`), the same bundled file started with a hidden command.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { OpError } from "./diag.js";

// ---------------------------------------------------------------- fonts

export interface FontDeps {
  /** GET a URL; null when it fails (network, status other than 200) */
  get: (url: string) => Buffer | null;
  home: string;
}

export const realFontDeps: FontDeps = {
  get: (url) => {
    const r = spawnSync("curl", ["-sSfL", "-m", "30", url], { maxBuffer: 64 * 1024 * 1024, timeout: 40_000 });
    return r.status === 0 && r.stdout ? Buffer.from(r.stdout) : null;
  },
  home: homedir(),
};

/** The subsets a mock gets: Latin always, Vietnamese whenever the family has it (the products are often Vietnamese). */
export const FONT_SUBSETS = ["latin", "latin-ext", "vietnamese"] as const;

interface FontsourceMeta {
  id: string;
  family: string;
  subsets: string[];
  weights: number[];
  styles: string[];
  license: string;
  version: string;
  npmVersion: string;
  source?: string;
  category?: string;
  unicodeRange?: Record<string, string>;
  variants: Record<string, Record<string, Record<string, { url: { woff2?: string } }>>>;
}

export interface FetchedFont {
  family: string;
  id: string;
  license: string;
  version: string;
  weights: number[];
  styles: string[];
  subsets: string[];
  files: string[];
  css: string;
  cached: number;
}

export const fontId = (family: string) =>
  family
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Downloads one family into `<to>/<id>/` (woff2 per weight, style and subset), writes `<id>.css` with its
 * @font-face rules and a SOURCE.md naming licence, version and URLs, and returns what it wrote.
 */
export function fetchFont(family: string, opts: { weights?: number[]; italic?: boolean; to: string }, deps: FontDeps = realFontDeps): FetchedFont {
  const id = fontId(family);
  if (!id) throw new OpError("font: give a family name, for example \"Big Shoulders Display\"");
  const raw = deps.get(`https://api.fontsource.org/v1/fonts/${id}`);
  if (!raw) throw new OpError(`font: "${family}" is not on Fontsource (looked for id "${id}"), or the network is unreachable`);
  let meta: FontsourceMeta;
  try {
    meta = JSON.parse(raw.toString("utf8")) as FontsourceMeta;
  } catch {
    throw new OpError(`font: Fontsource returned something that is not JSON for "${id}"`);
  }
  if (!/^OFL/i.test(meta.license ?? "")) {
    throw new OpError(`font: ${meta.family} is licensed ${meta.license || "under an unknown licence"}, not OFL; a mock may only use OFL fonts`);
  }
  const weights = opts.weights?.length ? opts.weights : meta.weights.filter((w) => w === 400 || w === 700);
  const missing = weights.filter((w) => !meta.weights.includes(w));
  if (missing.length) throw new OpError(`font: ${meta.family} has no weight ${missing.join(", ")} (it has ${meta.weights.join(", ")})`);
  const styles = ["normal", ...(opts.italic && meta.styles.includes("italic") ? ["italic"] : [])];
  const subsets = FONT_SUBSETS.filter((s) => meta.subsets.includes(s));
  if (!subsets.length) throw new OpError(`font: ${meta.family} has none of the subsets ${FONT_SUBSETS.join(", ")}`);

  const dir = join(opts.to, meta.id);
  mkdirSync(dir, { recursive: true });
  const cache = usableCache(deps.home, `${meta.id}@${meta.npmVersion}`);
  const files: string[] = [];
  const rules: string[] = [];
  let cached = 0;
  for (const w of weights) {
    for (const style of styles) {
      for (const subset of subsets) {
        const url = meta.variants[String(w)]?.[style]?.[subset]?.url.woff2;
        if (!url) continue;
        const name = `${subset}-${w}-${style}.woff2`;
        const target = join(dir, name);
        const hit = cache && existsSync(join(cache, name));
        if (hit) {
          copyFileSync(join(cache!, name), target);
          cached++;
        } else {
          const body = deps.get(url);
          if (!body) throw new OpError(`font: could not download ${url}`);
          writeFileSync(target, body);
          if (cache) {
            try {
              writeFileSync(join(cache, name), body);
            } catch {
              /* the cache is a convenience */
            }
          }
        }
        files.push(join(meta.id, name));
        const range = meta.unicodeRange?.[subset];
        rules.push(
          `@font-face {\n  font-family: "${meta.family}";\n  font-style: ${style};\n  font-weight: ${w};\n  font-display: swap;\n  src: url("./${meta.id}/${name}") format("woff2");${range ? `\n  unicode-range: ${range};` : ""}\n}`,
        );
      }
    }
  }
  if (!files.length) throw new OpError(`font: Fontsource lists no woff2 file for ${meta.family} at weight ${weights.join(", ")}`);
  const css = `/* ${meta.family} ${meta.version}, ${meta.license}, from Fontsource (${meta.source ?? "source not stated"}) */\n${rules.join("\n")}\n`;
  writeFileSync(join(opts.to, `${meta.id}.css`), css);
  writeFileSync(
    join(dir, "SOURCE.md"),
    `# ${meta.family}\n\n- Licence: ${meta.license} (SIL Open Font License). Redistribution with the mock is allowed; the font may not be sold on its own.\n- Version: ${meta.version} (Fontsource package ${meta.npmVersion})\n- Upstream: ${meta.source ?? "not stated"}\n- Metadata: https://api.fontsource.org/v1/fonts/${meta.id}\n- Files: ${files.map((f) => f.slice(meta.id.length + 1)).join(", ")}\n`,
  );
  return { family: meta.family, id: meta.id, license: meta.license, version: meta.version, weights, styles, subsets, files, css: `${meta.id}.css`, cached };
}

/** The cache folder for one family version, or null when the home directory cannot be written. */
function usableCache(home: string, key: string): string | null {
  const dir = join(home, ".aidw", "cache", "fonts", key);
  try {
    mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- screenshots

export interface Viewport {
  name: string;
  width: number;
  height: number;
  mobile: boolean;
}

/** The two sizes every mock is looked at: a laptop and a phone. */
export const MOCK_VIEWPORTS: Viewport[] = [
  { name: "desktop", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
export const MOCK_THEMES = ["light", "dark"] as const;

export interface Shot {
  page: string;
  viewport: Viewport;
  theme: (typeof MOCK_THEMES)[number];
  file: string;
}

/** Every screenshot a mock folder needs: each top-level HTML file at each viewport in each theme. */
export function planShots(dir: string): Shot[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new OpError(`mock shots: ${dir} is not a folder`);
  const pages = readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .sort();
  if (!pages.length) throw new OpError(`mock shots: no .html file in ${dir}`);
  const shots: Shot[] = [];
  for (const page of pages) {
    for (const viewport of MOCK_VIEWPORTS) {
      for (const theme of MOCK_THEMES) {
        shots.push({ page, viewport, theme, file: join("shots", `${page.replace(/\.html$/, "")}-${viewport.name}-${theme}.png`) });
      }
    }
  }
  return shots;
}

export interface ShotsRequest {
  dir: string;
  /** the CDP endpoint of the test browser, http://127.0.0.1:<port> */
  cdp: string;
  /** capture the whole page height (landing pages), not just the first screen */
  full: boolean;
}

export interface ShotsResult {
  written: string[];
  errors: string[];
}

/**
 * Runs the screenshots in a child process and returns its result. `self` is the CLI file to start; the child runs
 * `runShotsWorker` and prints the result as JSON.
 */
export function takeShots(req: ShotsRequest, self: string, execPath = process.execPath): ShotsResult {
  const r = spawnSync(execPath, [self, SHOTS_WORKER, JSON.stringify(req)], { encoding: "utf8", timeout: 180_000 });
  const line = (r.stdout ?? "").trim().split("\n").pop() ?? "";
  try {
    return JSON.parse(line) as ShotsResult;
  } catch {
    throw new OpError(`mock shots: the screenshot process failed${r.stderr ? `: ${r.stderr.trim().split("\n").slice(-3).join(" ")}` : ""}`);
  }
}

export const SHOTS_WORKER = "__mock-shots-worker";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
};

/** Serves one folder on 127.0.0.1 (a free port) so fonts and images load as they would from a site, not from file://. */
export function serveFolder(dir: string): Promise<{ server: Server; base: string }> {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    const file = resolve(root, `.${path === "/" ? "/index.html" : path}`);
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(file));
  });
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      ok({ server, base: `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}` });
    });
  });
}

/** A minimal CDP client over the browser's WebSocket (Node 22+ has WebSocket built in). */
class Cdp {
  private id = 0;
  private waiting = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
  private listeners: Array<(m: any) => void> = [];
  private constructor(private ws: WebSocket) {
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && this.waiting.has(m.id)) {
        const w = this.waiting.get(m.id)!;
        this.waiting.delete(m.id);
        if (m.error) w.fail(new Error(`${m.error.message}`));
        else w.ok(m.result);
      } else for (const l of this.listeners) l(m);
    });
  }
  static async connect(url: string): Promise<Cdp> {
    if (typeof WebSocket === "undefined") throw new Error("this Node has no built-in WebSocket; mock shots need Node 22 or later");
    const ws = new WebSocket(url);
    await new Promise<void>((ok, fail) => {
      ws.addEventListener("open", () => ok());
      ws.addEventListener("error", () => fail(new Error(`cannot connect to ${url}`)));
    });
    return new Cdp(ws);
  }
  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((ok, fail) => this.waiting.set(id, { ok, fail }));
  }
  once(method: string, sessionId: string, timeoutMs: number): Promise<void> {
    return new Promise((ok) => {
      const t = setTimeout(done, timeoutMs);
      const self = this;
      function done() {
        clearTimeout(t);
        self.listeners = self.listeners.filter((l) => l !== listen);
        ok();
      }
      function listen(m: any) {
        if (m.method === method && m.sessionId === sessionId) done();
      }
      this.listeners.push(listen);
    });
  }
  close() {
    this.ws.close();
  }
}

/** The child process: serves the folder, opens one tab per shot in the test browser and saves each PNG. */
export async function runShotsWorker(req: ShotsRequest): Promise<ShotsResult> {
  const shots = planShots(req.dir);
  const result: ShotsResult = { written: [], errors: [] };
  const version = await fetch(`${req.cdp}/json/version`).then((r) => r.json() as Promise<{ webSocketDebuggerUrl: string }>);
  const cdp = await Cdp.connect(version.webSocketDebuggerUrl);
  const { server, base } = await serveFolder(req.dir);
  mkdirSync(join(req.dir, "shots"), { recursive: true });
  try {
    for (const shot of shots) {
      let targetId: string | undefined;
      try {
        ({ targetId } = await cdp.send("Target.createTarget", { url: "about:blank" }));
        const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
        const { width, height, mobile } = shot.viewport;
        await cdp.send("Page.enable", {}, sessionId);
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile }, sessionId);
        await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: shot.theme }] }, sessionId);
        const loaded = cdp.once("Page.loadEventFired", sessionId, 15_000);
        await cdp.send("Page.navigate", { url: `${base}/${encodeURIComponent(shot.page)}` }, sessionId);
        await loaded;
        await cdp.send("Runtime.evaluate", { expression: "document.fonts.ready.then(() => new Promise(r => setTimeout(r, 300)))", awaitPromise: true }, sessionId);
        const params: Record<string, unknown> = { format: "png" };
        if (req.full) {
          const m = await cdp.send("Page.getLayoutMetrics", {}, sessionId);
          const h = Math.ceil(m.cssContentSize?.height ?? m.contentSize.height);
          params.captureBeyondViewport = true;
          params.clip = { x: 0, y: 0, width, height: Math.max(height, Math.min(h, 12_000)), scale: 1 };
        }
        const { data } = await cdp.send("Page.captureScreenshot", params, sessionId);
        writeFileSync(join(req.dir, shot.file), Buffer.from(data, "base64"));
        result.written.push(shot.file);
      } catch (e) {
        result.errors.push(`${shot.file}: ${(e as Error).message}`);
      } finally {
        if (targetId) await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
      }
    }
  } finally {
    cdp.close();
    server.close();
  }
  return result;
}

