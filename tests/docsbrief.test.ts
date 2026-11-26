import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import {
  checkDocsBrief,
  docsBriefPath,
  DOCS_BRIEF_MAX_AGE_DAYS,
  libSlug,
  parseDocsRef,
  parseVersion,
  sameVersionLine,
  topicSlug,
} from "../src/docsbrief.js";
import { tempProject, write } from "./fixtures.js";

// The Docs Brief store (plan T5; R1, R3, R9, Q-R3; ADR-0016): one brief per library, major.minor and topic under
// .aidw/research/docs/, reused while the installed version is on the same line and the brief is at most 90 days old.

const TODAY = new Date("2026-11-26T10:00:00Z");
const daysBefore = (n: number) => new Date(TODAY.getTime() - n * 86_400_000).toISOString().slice(0, 10);

const brief = (meta: Record<string, string | undefined>, body = BODY) =>
  `---\n${Object.entries(meta)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")}\n---\n\n${body}`;
const BODY = `# next@15.1 caching

## Question
How does fetch caching work in route handlers?

## Answer
GET route handlers are not cached by default in 15.1.

## Evidence
| # | Claim | Quote | Source (title, URL#anchor, date read) | Version | Tier | Kind | Confidence |
|---|---|---|---|---|---|---|---|

## Pitfalls
None found.

## Not found
None.
`;

function store(meta: Record<string, string | undefined>, lib = "next", mm = "15.1", topic = "caching", body = BODY) {
  const root = tempProject();
  write(root, `.aidw/research/docs/${lib}@${mm}-${topic}.md`, brief(meta, body));
  return join(root, ".aidw");
}

describe("versions", () => {
  it("reads installed versions and ranges down to major, minor, patch and prerelease", () => {
    expect(parseVersion("15.1.3")).toMatchObject({ major: 15, minor: 1, patch: 3, prerelease: null });
    expect(parseVersion("^15.1.3")).toMatchObject({ major: 15, minor: 1, patch: 3 });
    expect(parseVersion("~0.4")).toMatchObject({ major: 0, minor: 4, patch: null });
    expect(parseVersion("v2.10.0")).toMatchObject({ major: 2, minor: 10 });
    expect(parseVersion("15.2.0-canary.3")).toMatchObject({ major: 15, minor: 2, patch: 0, prerelease: "canary.3" });
    expect(parseVersion("1.2.3+build.7")).toMatchObject({ prerelease: null });
  });

  it("refuses what names no minor version", () => {
    for (const v of ["15", "latest", "", "15.x", "*", "a.b"]) expect(parseVersion(v), v).toBeNull();
  });

  it("keeps 15.10 apart from 15.1 (a version is never a number)", () => {
    expect(sameVersionLine("15.10.0", "15.1.0")).toBe(false);
  });

  it("a brief holds for every patch of the same major.minor", () => {
    expect(sameVersionLine("15.1.3", "15.1.9")).toBe(true);
    expect(sameVersionLine("15.1.3", "15.2.0")).toBe(false);
    expect(sameVersionLine("15.1.3", "16.1.3")).toBe(false);
  });

  it("0.x: the minor is the breaking line, so 0.4.1 and 0.4.7 share a brief but 0.5 does not", () => {
    expect(sameVersionLine("0.4.1", "0.4.7")).toBe(true);
    expect(sameVersionLine("0.4.1", "0.5.0")).toBe(false);
  });

  it("0.0.x: every patch may break, so only the same patch matches", () => {
    expect(sameVersionLine("0.0.3", "0.0.3")).toBe(true);
    expect(sameVersionLine("0.0.3", "0.0.4")).toBe(false);
  });

  it("a prerelease matches only the exact same version, on either side", () => {
    expect(sameVersionLine("15.2.0-canary.3", "15.2.0-canary.3")).toBe(true);
    expect(sameVersionLine("15.2.0-canary.3", "15.2.0-canary.4")).toBe(false);
    expect(sameVersionLine("15.2.0-canary.3", "15.2.0")).toBe(false);
    expect(sameVersionLine("15.2.0", "15.2.1-rc.1")).toBe(false);
  });
});

describe("the path of a brief", () => {
  it("is .aidw/research/docs/<lib>@<major.minor>-<topic>.md", () => {
    expect(docsBriefPath("/p/.aidw", "next", "15.1.3", "caching")).toBe(join("/p/.aidw", "research", "docs", "next@15.1-caching.md"));
    expect(docsBriefPath("/p/.aidw", "next", "^15.1.0-canary.2", "Route Handlers")).toBe(join("/p/.aidw", "research", "docs", "next@15.1-route-handlers.md"));
  });

  it("writes a scoped package without its @ and its slash", () => {
    expect(libSlug("@tanstack/react-query")).toBe("tanstack__react-query");
    expect(docsBriefPath("/p/.aidw", "@tanstack/react-query", "5.62.3", "caching")).toMatch(/tanstack__react-query@5\.62-caching\.md$/);
  });

  it("turns a topic into lower-case words joined by dashes", () => {
    expect(topicSlug("  Server Actions / forms ")).toBe("server-actions-forms");
    expect(() => topicSlug("!!")).toThrow(/topic/);
  });

  it("refuses a version without a minor and a library name it cannot write as a file", () => {
    expect(() => docsBriefPath("/p/.aidw", "next", "latest", "caching")).toThrow(/version/);
    expect(() => docsBriefPath("/p/.aidw", "../etc", "1.0.0", "caching")).toThrow(/library/);
  });
});

describe("a docs: entry (R8)", () => {
  it("reads <lib>@<version> <topic>, a scoped package included", () => {
    expect(parseDocsRef("next@15.1.3 caching")).toEqual({ lib: "next", version: "15.1.3", topic: "caching" });
    expect(parseDocsRef("@tanstack/react-query@5.62.3 query invalidation")).toEqual({ lib: "@tanstack/react-query", version: "5.62.3", topic: "query invalidation" });
  });

  it("refuses an entry without a version or a topic", () => {
    expect(() => parseDocsRef("next caching")).toThrow(/<lib>@<version> <topic>/);
    expect(() => parseDocsRef("next@15.1.3")).toThrow(/<lib>@<version> <topic>/);
  });
});

describe("checkDocsBrief: reuse while the line matches and the brief is at most 90 days old (R9)", () => {
  const ref = { lib: "next", version: "15.1.7", topic: "caching" };
  const fresh = { lib: "next", version: "15.1.3", topic: "caching", date: daysBefore(10) };

  it("a brief of the same major.minor, 10 days old, is fresh", () => {
    const c = checkDocsBrief(store(fresh), ref, TODAY);
    expect(c.status).toBe("fresh");
    expect(c.rel).toBe(".aidw/research/docs/next@15.1-caching.md");
    expect(c.brief).toMatchObject({ version: "15.1.3", ageDays: 10 });
  });

  it("no file is missing, with the path to write", () => {
    const c = checkDocsBrief(join(tempProject(), ".aidw"), ref, TODAY);
    expect(c.status).toBe("missing");
    expect(c.rel).toBe(".aidw/research/docs/next@15.1-caching.md");
  });

  it("another minor looks for another file", () => {
    expect(checkDocsBrief(store(fresh), { ...ref, version: "15.2.0" }, TODAY).status).toBe("missing");
  });

  it(`is fresh at exactly ${DOCS_BRIEF_MAX_AGE_DAYS} days and stale the day after`, () => {
    expect(checkDocsBrief(store({ ...fresh, date: daysBefore(90) }), ref, TODAY).status).toBe("fresh");
    const c = checkDocsBrief(store({ ...fresh, date: daysBefore(91) }), ref, TODAY);
    expect(c.status).toBe("stale");
    expect(c.reasons.join()).toMatch(/91 days old/);
  });

  it("a brief written today is fresh", () => {
    expect(checkDocsBrief(store({ ...fresh, date: daysBefore(0) }), ref, TODAY).status).toBe("fresh");
  });

  it("a brief without a date cannot prove its age: invalid", () => {
    const c = checkDocsBrief(store({ ...fresh, date: undefined }), ref, TODAY);
    expect(c.status).toBe("invalid");
    expect(c.reasons.join()).toMatch(/date/);
  });

  it("a date that is not a calendar day, or lies in the future, is invalid", () => {
    expect(checkDocsBrief(store({ ...fresh, date: "2026-02-30" }), ref, TODAY).status).toBe("invalid");
    expect(checkDocsBrief(store({ ...fresh, date: "last week" }), ref, TODAY).status).toBe("invalid");
    expect(checkDocsBrief(store({ ...fresh, date: "2026-12-01" }), ref, TODAY).reasons.join()).toMatch(/future/);
  });

  it("a version that does not belong to the file name is invalid", () => {
    const c = checkDocsBrief(store({ ...fresh, version: "15.2.0" }), ref, TODAY);
    expect(c.status).toBe("invalid");
    expect(c.reasons.join()).toMatch(/15\.2\.0/);
  });

  it("a missing version, library or topic in the front matter is invalid", () => {
    for (const k of ["version", "lib", "topic"]) expect(checkDocsBrief(store({ ...fresh, [k]: undefined }), ref, TODAY).status, k).toBe("invalid");
  });

  it("a brief whose library or topic differs from its file name is invalid", () => {
    expect(checkDocsBrief(store({ ...fresh, lib: "react" }), ref, TODAY).status).toBe("invalid");
    expect(checkDocsBrief(store({ ...fresh, topic: "routing" }), ref, TODAY).status).toBe("invalid");
  });

  it("a brief without one of the five sections is invalid (R1)", () => {
    const c = checkDocsBrief(store(fresh, "next", "15.1", "caching", BODY.replace("## Pitfalls", "## Gotchas")), ref, TODAY);
    expect(c.status).toBe("invalid");
    expect(c.reasons.join()).toMatch(/## Pitfalls/);
  });

  it("a brief written for a prerelease is stale for the release of the same line", () => {
    const aidw = store({ ...fresh, version: "15.1.0-canary.3" });
    expect(checkDocsBrief(aidw, ref, TODAY).status).toBe("stale");
    expect(checkDocsBrief(aidw, { ...ref, version: "15.1.0-canary.3" }, TODAY).status).toBe("fresh");
  });

  it("0.0.x: a brief for another patch is stale", () => {
    const aidw = store({ lib: "tiny", version: "0.0.3", topic: "caching", date: daysBefore(1) }, "tiny", "0.0");
    expect(checkDocsBrief(aidw, { lib: "tiny", version: "0.0.4", topic: "caching" }, TODAY).status).toBe("stale");
    expect(checkDocsBrief(aidw, { lib: "tiny", version: "0.0.3", topic: "caching" }, TODAY).status).toBe("fresh");
  });

  it("reads a quoted version as text (15.10 stays 15.10)", () => {
    const aidw = store({ lib: "next", version: '"15.10"', topic: "caching", date: daysBefore(1) }, "next", "15.10");
    expect(checkDocsBrief(aidw, { ...ref, version: "15.10.2" }, TODAY).status).toBe("fresh");
    const bare = store({ lib: "next", version: "15.10", topic: "caching", date: daysBefore(1) }, "next", "15.10");
    expect(checkDocsBrief(bare, { ...ref, version: "15.10.2" }, TODAY).status).toBe("fresh");
  });
});

describe("aidw docs-brief", () => {
  function cli(root: string, ...argv: string[]) {
    let out = "";
    let err = "";
    const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
    return { code, out, err };
  }
  const today = new Date().toISOString().slice(0, 10);

  it("prints FRESH and exits 0 for a brief that may be reused", () => {
    const root = tempProject();
    cli(root, "init");
    write(root, ".aidw/research/docs/next@15.1-caching.md", brief({ lib: "next", version: "15.1.3", topic: "caching", date: today }));
    const r = cli(root, "docs-brief", "next@15.1.9", "caching");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^FRESH \.aidw\/research\/docs\/next@15\.1-caching\.md/);
  });

  it("prints MISSING with the path to write, takes a topic of several words, and exits 1", () => {
    const root = tempProject();
    cli(root, "init");
    const r = cli(root, "docs-brief", "@tanstack/react-query@5.62.3", "query", "invalidation");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^MISSING \.aidw\/research\/docs\/tanstack__react-query@5\.62-query-invalidation\.md/);
    expect(r.out).toMatch(/docs-research/);
  });

  it("answers in JSON with --json", () => {
    const root = tempProject();
    cli(root, "init");
    const r = cli(root, "docs-brief", "next@15.1.9", "caching", "--json");
    expect(JSON.parse(r.out)).toMatchObject({ status: "missing", rel: ".aidw/research/docs/next@15.1-caching.md" });
  });

  it("refuses an entry without a version", () => {
    const root = tempProject();
    cli(root, "init");
    const r = cli(root, "docs-brief", "next", "caching");
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/<lib>@<version>/);
  });
});
