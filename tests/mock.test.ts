import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { OpError } from "../src/diag.js";
import { fetchFont, fontId, planShots, serveFolder, type FontDeps } from "../src/mock.js";

const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "aidw-mock-"));
  temps.push(d);
  return d;
};

const url = (id: string, subset: string, w: number, style = "normal") => `https://cdn.jsdelivr.net/fontsource/fonts/${id}@5.3.0/${subset}-${w}-${style}.woff2`;

/** What Fontsource answers for one family, shaped like its v1 API. */
function meta(id: string, family: string, license = "OFL-1.1", subsets = ["latin", "latin-ext", "vietnamese", "cyrillic"]) {
  const variants: Record<string, Record<string, Record<string, { url: { woff2: string } }>>> = {};
  for (const w of [400, 700, 800]) {
    variants[w] = {};
    for (const style of ["normal", "italic"]) {
      variants[w]![style] = Object.fromEntries(subsets.map((s) => [s, { url: { woff2: url(id, s, w, style) } }]));
    }
  }
  return {
    id,
    family,
    subsets,
    weights: [400, 700, 800],
    styles: ["normal", "italic"],
    license,
    version: "v21",
    npmVersion: "5.3.0",
    source: "https://github.com/google/fonts",
    unicodeRange: { latin: "U+0000-00FF", vietnamese: "U+0102-0103" },
    variants,
  };
}

function fakeNet(answers: Record<string, unknown>, home = tmp()) {
  const asked: string[] = [];
  const deps: FontDeps = {
    home,
    get: (u) => {
      asked.push(u);
      if (u.startsWith("https://api.fontsource.org/")) {
        const id = u.split("/").pop()!;
        return answers[id] ? Buffer.from(JSON.stringify(answers[id])) : null;
      }
      return Buffer.from(`font bytes of ${u}`);
    },
  };
  return { deps, asked };
}

describe("aidw mock font", () => {
  it("turns a family name into the Fontsource id", () => {
    expect(fontId("Big Shoulders Display")).toBe("big-shoulders-display");
    expect(fontId("  IBM Plex Sans  ")).toBe("ibm-plex-sans");
  });

  it("downloads the asked weights in latin, latin-ext and vietnamese, and writes @font-face rules and a source note", () => {
    const to = tmp();
    const { deps } = fakeNet({ "big-shoulders-display": meta("big-shoulders-display", "Big Shoulders Display") });
    const f = fetchFont("Big Shoulders Display", { weights: [800], to }, deps);
    expect(f.subsets).toEqual(["latin", "latin-ext", "vietnamese"]); // never cyrillic, which the mock does not need
    expect(f.files).toEqual(["big-shoulders-display/latin-800-normal.woff2", "big-shoulders-display/latin-ext-800-normal.woff2", "big-shoulders-display/vietnamese-800-normal.woff2"]);
    const css = readFileSync(join(to, "big-shoulders-display.css"), "utf8");
    expect(css).toContain('font-family: "Big Shoulders Display"');
    expect(css).toContain('src: url("./big-shoulders-display/vietnamese-800-normal.woff2") format("woff2")');
    expect(css).toContain("unicode-range: U+0102-0103");
    expect(css).toContain("OFL-1.1");
    expect(readFileSync(join(to, "big-shoulders-display", "SOURCE.md"), "utf8")).toMatch(/Licence: OFL-1\.1/);
  });

  it("takes 400 and 700 when no weight is given, and the italic only when asked", () => {
    const { deps } = fakeNet({ "instrument-sans": meta("instrument-sans", "Instrument Sans") });
    expect(fetchFont("Instrument Sans", { to: tmp() }, deps).files.filter((f) => f.includes("italic"))).toEqual([]);
    const f = fetchFont("Instrument Sans", { to: tmp(), italic: true }, deps);
    expect(f.weights).toEqual([400, 700]);
    expect(f.files.some((x) => x.endsWith("latin-400-italic.woff2"))).toBe(true);
  });

  it("refuses a family that is not OFL", () => {
    const { deps } = fakeNet({ "some-font": meta("some-font", "Some Font", "Apache-2.0") });
    expect(() => fetchFont("Some Font", { to: tmp() }, deps)).toThrow(/Apache-2\.0, not OFL/);
  });

  it("names the weights a family has when the asked one is missing", () => {
    const { deps } = fakeNet({ "instrument-sans": meta("instrument-sans", "Instrument Sans") });
    expect(() => fetchFont("Instrument Sans", { weights: [300], to: tmp() }, deps)).toThrow(/no weight 300 \(it has 400, 700, 800\)/);
  });

  it("says so when Fontsource does not know the family", () => {
    const { deps } = fakeNet({});
    expect(() => fetchFont("Made Up Grotesk", { to: tmp() }, deps)).toThrow(OpError);
  });

  it("serves a second download of the same version from the cache", () => {
    const home = tmp();
    const { deps, asked } = fakeNet({ "instrument-sans": meta("instrument-sans", "Instrument Sans") }, home);
    fetchFont("Instrument Sans", { weights: [400], to: tmp() }, deps);
    const before = asked.length;
    const again = fetchFont("Instrument Sans", { weights: [400], to: tmp() }, deps);
    expect(again.cached).toBe(3);
    expect(asked.length - before).toBe(1); // only the metadata
    expect(existsSync(join(home, ".aidw", "cache", "fonts", "instrument-sans@5.3.0", "latin-400-normal.woff2"))).toBe(true);
  });

  it("still downloads when the cache cannot be written", () => {
    const home = tmp();
    writeFileSync(join(home, ".aidw"), "a file where the folder should be");
    const { deps } = fakeNet({ "instrument-sans": meta("instrument-sans", "Instrument Sans") }, home);
    expect(fetchFont("Instrument Sans", { weights: [400], to: tmp() }, deps).files).toHaveLength(3);
  });
});

describe("aidw mock shots", () => {
  it("plans each page at desktop and phone width, in light and dark", () => {
    const dir = tmp();
    writeFileSync(join(dir, "main.html"), "<p>main</p>");
    writeFileSync(join(dir, "landing.html"), "<p>landing</p>");
    writeFileSync(join(dir, "tokens.css"), "");
    const files = planShots(dir).map((s) => s.file);
    expect(files).toHaveLength(8);
    expect(files).toContain(join("shots", "main-desktop-light.png"));
    expect(files).toContain(join("shots", "landing-phone-dark.png"));
    expect(planShots(dir).find((s) => s.viewport.name === "phone")!.viewport).toMatchObject({ width: 390, mobile: true });
  });

  it("refuses a folder with no page", () => {
    expect(() => planShots(tmp())).toThrow(/no \.html file/);
  });

  it("serves the mock folder with font types and nothing outside it", async () => {
    const dir = tmp();
    mkdirSync(join(dir, "fonts"));
    writeFileSync(join(dir, "fonts", "a.woff2"), "x");
    writeFileSync(join(dir, "main.html"), "<p>hi</p>");
    const { server, base } = await serveFolder(dir);
    try {
      const font = await fetch(`${base}/fonts/a.woff2`);
      expect(font.headers.get("content-type")).toBe("font/woff2");
      expect((await fetch(`${base}/main.html`)).status).toBe(200);
      expect((await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`)).status).toBe(403);
      expect((await fetch(`${base}/missing.css`)).status).toBe(404);
    } finally {
      server.close();
    }
  });
});
