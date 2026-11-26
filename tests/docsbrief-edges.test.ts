import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { checkDocsBrief, docsBriefName, docsBriefPath, libSlug, parseDocsRef, topicSlug } from "../src/docsbrief.js";
import { ANALYSIS_MD, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, MAIN_SPEC, planReviewed, tempProject, write } from "./fixtures.js";

// Edges of the Docs Brief store (plan T5; R1, R9, Q-R3; ADR-0016) that docsbrief.test.ts leaves open: the age
// boundary at any hour of the local day in several timezones, the 15.9 / 15.10 line, odd library and topic names, the CLI's exit codes and
// JSON shape, and `aidw validate` on a Change that has no Docs Brief.

const SECTIONS = ["Question", "Answer", "Evidence", "Pitfalls", "Not found"].map((s) => `## ${s}\nx\n`).join("\n");
const brief = (meta: Record<string, string>) =>
  `---\n${Object.entries(meta)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")}\n---\n\n${SECTIONS}`;

function store(file: string, meta: Record<string, string>): string {
  const root = tempProject();
  write(root, `.aidw/research/docs/${file}`, brief(meta));
  return join(root, ".aidw");
}

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}

describe("the 90-day age counts local calendar days, whatever the hour or the timezone (R9, Q-R3)", () => {
  const ref = { lib: "next", version: "15.1.7", topic: "caching" };
  const meta = (date: string) => ({ lib: "next", version: "15.1.3", topic: "caching", date });
  const tz = process.env.TZ;
  afterEach(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  // 2026-08-28 is 90 days before 2026-11-26, 2026-08-27 is 91. The check time is built as a local time in each zone.
  for (const zone of ["UTC", "Asia/Ho_Chi_Minh", "America/Los_Angeles"]) {
    for (const [h, m, s] of [[0, 0, 0], [0, 0, 1], [12, 0, 0], [23, 59, 59]] as const) {
      it(`in ${zone} at ${h}:${m}:${s} local: 90 days fresh, 91 days stale`, () => {
        process.env.TZ = zone;
        const today = new Date(2026, 10, 26, h, m, s);
        const at90 = checkDocsBrief(store("next@15.1-caching.md", meta("2026-08-28")), ref, today);
        expect(at90.status).toBe("fresh");
        expect(at90.brief?.ageDays).toBe(90);
        const at91 = checkDocsBrief(store("next@15.1-caching.md", meta("2026-08-27")), ref, today);
        expect(at91.status).toBe("stale");
        expect(at91.brief?.ageDays).toBe(91);
      });
    }
  }

  it("counts across a daylight-saving change and a leap day as whole days", () => {
    // New York leaves DST on 2026-11-01 and enters it on 2028-03-12; 2028 is a leap year and 2028-02-29 to
    // 2028-05-29 is 90 days.
    process.env.TZ = "America/New_York";
    expect(checkDocsBrief(store("next@15.1-caching.md", meta("2026-08-28")), ref, new Date(2026, 10, 26, 23, 30)).brief?.ageDays).toBe(90);
    expect(checkDocsBrief(store("next@15.1-caching.md", meta("2028-02-29")), ref, new Date(2028, 4, 29, 23, 0)).status).toBe("fresh");
    expect(checkDocsBrief(store("next@15.1-caching.md", meta("2028-02-29")), ref, new Date(2028, 4, 30, 0, 30)).status).toBe("stale");
  });

  it("the same instant is a different day in two zones, and the age follows the local day", () => {
    // 2026-11-27T04:30Z is 2026-11-26 23:30 in New York and 2026-11-27 11:30 in Hanoi.
    const instant = new Date("2026-11-27T04:30:00Z");
    process.env.TZ = "America/New_York";
    expect(checkDocsBrief(store("next@15.1-caching.md", meta("2026-08-29")), ref, instant).brief?.ageDays).toBe(89);
    process.env.TZ = "Asia/Ho_Chi_Minh";
    expect(checkDocsBrief(store("next@15.1-caching.md", meta("2026-08-29")), ref, instant).brief?.ageDays).toBe(90);
  });

  it("a brief dated today in a timezone ahead of UTC is not refused as written in the future", () => {
    // At 2026-11-26 20:00 UTC it is already 2026-11-27 in Tokyo (UTC+9): a brief written there and then, dated with
    // the local day, must not read as invalid the moment it is written.
    process.env.TZ = "Asia/Tokyo";
    const c = checkDocsBrief(store("next@15.1-caching.md", meta("2026-11-27")), ref, new Date("2026-11-26T20:00:00Z"));
    expect(c.status, c.reasons.join("; ")).toBe("fresh");
    expect(c.brief?.ageDays).toBe(0);
  });

  it("a brief dated tomorrow in the local zone is still refused as written in the future", () => {
    process.env.TZ = "Asia/Tokyo";
    const c = checkDocsBrief(store("next@15.1-caching.md", meta("2026-11-28")), ref, new Date("2026-11-26T20:00:00Z"));
    expect(c.status).toBe("invalid");
    expect(c.reasons.join()).toMatch(/future/);
  });
});

describe("the major.minor line at a two-digit minor (R9)", () => {
  it("15.9 and 15.10 are two files, and neither brief holds for the other", () => {
    expect(docsBriefName("next", "15.9.4", "caching")).toBe("next@15.9-caching.md");
    expect(docsBriefName("next", "15.10.0", "caching")).toBe("next@15.10-caching.md");
    const aidw = store("next@15.9-caching.md", { lib: "next", version: "15.9.4", topic: "caching", date: "2026-11-20" });
    const today = new Date("2026-11-26T10:00:00Z");
    expect(checkDocsBrief(aidw, { lib: "next", version: "15.9.9", topic: "caching" }, today).status).toBe("fresh");
    expect(checkDocsBrief(aidw, { lib: "next", version: "15.10.0", topic: "caching" }, today).status).toBe("missing");
  });

  it("a brief in the 15.10 file that says 15.1 is invalid, not fresh", () => {
    const aidw = store("next@15.10-caching.md", { lib: "next", version: '"15.1.0"', topic: "caching", date: "2026-11-20" });
    const c = checkDocsBrief(aidw, { lib: "next", version: "15.10.2", topic: "caching" }, new Date("2026-11-26T10:00:00Z"));
    expect(c.status).toBe("invalid");
  });

  it("a range or v-prefixed installed version finds the same file", () => {
    for (const v of ["^15.10.2", "~15.10", "v15.10.0", "15.10.2+build.1"]) expect(docsBriefName("next", v, "caching"), v).toBe("next@15.10-caching.md");
  });
});

describe("odd library and topic names give a safe file name inside research/docs (Q-R3)", () => {
  const dir = join("/p/.aidw", "research", "docs");
  const inside = (p: string) => {
    const r = relative(dir, p);
    return !r.startsWith("..") && !r.includes(sep);
  };

  it("a topic with ../, slashes, backslashes, spaces, capitals or punctuation stays one file inside the store", () => {
    for (const t of ["../../etc/passwd", "a/b\\c", "  Server Actions  ", "CACHING", "route.handlers", "naïve café", "x\0y"]) {
      const p = docsBriefPath("/p/.aidw", "next", "15.1.3", t);
      expect(inside(p), `${t} -> ${p}`).toBe(true);
      expect(topicSlug(t), t).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("a topic of only dots or slashes is refused", () => {
    for (const t of ["..", "../", "/", "  "]) expect(() => topicSlug(t), t).toThrow(/topic/);
  });

  it("a library name that would leave the store, or has spaces or path separators, is refused", () => {
    for (const lib of ["..", "../next", "next/..", "a/b/c", "@a/b/c", "a\\b", "my lib", ".hidden", "-flag", "a..b", "", "@", "@/x", "next\0"]) {
      expect(() => libSlug(lib), JSON.stringify(lib)).toThrow(/library/);
    }
  });

  it("upper case is folded, so Next and next share one brief", () => {
    expect(docsBriefName("Next", "15.1.3", "Caching")).toBe(docsBriefName("next", "15.1.3", "caching"));
    expect(libSlug("@TanStack/React-Query")).toBe("tanstack__react-query");
  });

  it("a brief whose front matter names the library in another case still matches", () => {
    const aidw = store("next@15.1-caching.md", { lib: "Next", version: "15.1.3", topic: "Caching", date: "2026-11-20" });
    expect(checkDocsBrief(aidw, { lib: "next", version: "15.1.7", topic: "caching" }, new Date("2026-11-26T10:00:00Z")).status).toBe("fresh");
  });

  it("a version is used only as its numbers, so a version with a path in it cannot reach the file name", () => {
    expect(() => docsBriefName("next", "15.1.3/../../x", "caching")).toThrow(/version/);
    expect(parseDocsRef("next@15.1.3 ../x").topic).toBe("../x");
    expect(docsBriefName("next", "15.1.3", "../x")).toBe("next@15.1-x.md");
  });
});

describe("aidw docs-brief: exit codes and JSON (R9)", () => {
  // the local day, as Research writes it and as checkDocsBrief counts it
  const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = localDay(new Date());
  const longAgo = localDay(new Date(Date.now() - 200 * 86_400_000));

  function project() {
    const root = tempProject();
    expect(cli(root, "init").code).toBe(0);
    return root;
  }

  it("STALE exits 1 and names the path to rewrite", () => {
    const root = project();
    write(root, ".aidw/research/docs/next@15.1-caching.md", brief({ lib: "next", version: "15.1.3", topic: "caching", date: longAgo }));
    const r = cli(root, "docs-brief", "next@15.1.9", "caching");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^STALE \.aidw\/research\/docs\/next@15\.1-caching\.md: .*days old/);
    expect(r.out).toMatch(/docs-research/);
  });

  it("INVALID exits 1 with its reasons", () => {
    const root = project();
    write(root, ".aidw/research/docs/next@15.1-caching.md", "---\nlib: next\n---\n\nno sections\n");
    const r = cli(root, "docs-brief", "next@15.1.9", "caching");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^INVALID /);
    expect(r.out).toMatch(/## Question/);
  });

  it("--json gives ok, status, path, rel, reasons and brief, and the same exit code", () => {
    const root = project();
    write(root, ".aidw/research/docs/next@15.1-caching.md", brief({ lib: "next", version: "15.1.3", topic: "caching", date: today }));
    const fresh = cli(root, "docs-brief", "next@15.1.9", "caching", "--json");
    expect(fresh.code).toBe(0);
    const j = JSON.parse(fresh.out);
    expect(j).toMatchObject({ ok: true, status: "fresh", rel: ".aidw/research/docs/next@15.1-caching.md" });
    expect(j.path).toBe(join(root, ".aidw", "research", "docs", "next@15.1-caching.md"));
    expect(Array.isArray(j.reasons)).toBe(true);
    expect(j.brief).toMatchObject({ lib: "next", version: "15.1.3", topic: "caching", date: today, ageDays: 0 });

    const missing = cli(root, "docs-brief", "next@16.0.0", "caching", "--json");
    expect(missing.code).toBe(1);
    expect(JSON.parse(missing.out)).toMatchObject({ ok: false, status: "missing" });
  });

  it("a usage error (no topic, no version, a library that would leave the store) exits 2 and writes no file", () => {
    const root = project();
    for (const argv of [["next@15.1.3"], ["next@latest", "caching"], ["../../evil@1.0.0", "caching"], []]) {
      const r = cli(root, "docs-brief", ...argv);
      expect(r.code, argv.join(" ")).toBe(2);
      expect(r.err, argv.join(" ")).toMatch(/^aidw: /);
    }
    expect(existsSync(join(root, ".aidw", "research", "docs"))).toBe(false);
    expect(readdirSync(root)).toEqual([".aidw"]);
  });

  it("checking never writes the brief", () => {
    const root = project();
    cli(root, "docs-brief", "next@15.1.9", "caching");
    expect(existsSync(join(root, ".aidw", "research", "docs", "next@15.1-caching.md"))).toBe(false);
  });
});

describe("aidw validate does not depend on Docs Briefs", () => {
  const ID = "2026-11-08-booking";
  function ready(): string {
    const root = tempProject();
    expect(cli(root, "init").code).toBe(0);
    write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
    expect(cli(root, "change", "new", ID, "--title", "Booking", "--input-type", "upwork_jd").code).toBe(0);
    const c = `.aidw/changes/${ID}`;
    write(root, `${c}/analysis.md`, ANALYSIS_MD);
    write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
    write(root, `${c}/tasks.yaml`, TASKS_YAML);
    write(root, `${c}/quality.yaml`, QUALITY_YAML);
    write(root, `${c}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
    planReviewed(root, ID);
    return root;
  }

  it("a Change with no research/docs folder validates", () => {
    const root = ready();
    expect(existsSync(join(root, ".aidw", "research"))).toBe(false);
    const r = cli(root, "validate", ID);
    expect(r.code, r.out + r.err).toBe(0);
    expect(cli(root, "validate", "--strict").code).toBe(0);
  });

  it("a stale or broken brief in the store does not fail validate of a Change", () => {
    const root = ready();
    write(root, ".aidw/research/docs/next@15.1-caching.md", "not a brief\n");
    write(root, ".aidw/research/docs/react@19.0-hooks.md", brief({ lib: "react", version: "19.0.0", topic: "hooks", date: "2020-01-01" }));
    const r = cli(root, "validate", ID);
    expect(r.code, r.out + r.err).toBe(0);
  });
});
