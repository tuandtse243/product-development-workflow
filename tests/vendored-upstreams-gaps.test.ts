import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Gaps in the tests of T1 (rpi-upgrades I7, Q6): the copies are word for word (ADR-0005), the folders hold the
// upstream files and nothing else, and scripts/vendor.mjs honours `dest` without touching another upstream.
const root = join(__dirname, "..");
const vendor = join(root, "plugins", "aidw", "library", "vendor");
const showMe = join(vendor, "humanlayer");
const htmlEff = join(vendor, "anthropics", "html-effectiveness");

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const commitOf = (dir: string) => /Commit: `([0-9a-f]{40})`/.exec(readFileSync(join(dir, "UPSTREAM.md"), "utf8"))?.[1];

// sha256 of each upstream file at the commit recorded on 2026-11-26 (checked against the upstream tarballs).
// A re-sync to another commit records a new commit, and the pins then no longer apply.
const PINNED: Record<string, { commit: string; files: Record<string, string> }> = {
  humanlayer: {
    commit: "4d69d20f6e9b57b4fcf0d501ccfb1be961f0f329",
    files: {
      LICENSE: "5f13c18ea00ea5c1384f41745feeca774079164f7f59a92e4ac0899ad217b26f",
      "show-me/SKILL.md": "434a2346cc95e313b0d367d477dda2e23ba642dd2181757415a09500664af100",
      "show-me/agents/openai.yaml": "a1499d95abd8447558c535fe5554adcc3c9b988a0a39264a6283d430effe1e94",
    },
  },
  "anthropics/html-effectiveness": {
    commit: "58c305be97f47b26b678f2c07dec01d4242268ec",
    files: {
      LICENSE: "2e6105c36a95f04adbc36000b7b1ce65544385e27f8febb1b2f53b61fdb62bca",
      "01-exploration-code-approaches.html": "e51f9de9cf6c9bad0ed3aae551fe70c1b9a1aa2d0be5dabd45edd68eb218fe21",
      "02-exploration-visual-designs.html": "feea09c9003d7d7db6726ff1548177998f2e10777cb7dc5f5953ae56b0724c64",
      "03-code-review-pr.html": "f03ab7590f9962b3add85d3ae65076d66a6462b77af353eea455d315d64ac1f6",
      "04-code-understanding.html": "e4aed5fd3f203c22a6034cd488e0a302d523b6cecef737204dc4aac721aa76e4",
      "05-design-system.html": "b492cc28d3663edae8050cc7f8cd2d693c6601146d5a363e84e69b0f0cdc46ca",
      "06-component-variants.html": "9dd462d163e3004cc136bb6fcef22135a626beea77817533037830517d4a7429",
      "07-prototype-animation.html": "3d585d8c6a8eb565e0a4241d2065461c44ba22bf84bfdc1e4ac48ab9a7f0c16d",
      "08-prototype-interaction.html": "aba8e9b2cc60898bea2f2df963171401c3f07743809039785066f9526db7b709",
      "09-slide-deck.html": "e191d49c28569e5f2ae09ed3bc4dc3f8ef25f90f1c842b1458f7b43ef5153291",
      "10-svg-illustrations.html": "1380bb696b5c983f4f605b13819a5de9f8d93a9fe982c6e9e9e707c26e490bb6",
      "11-status-report.html": "6468f720bab1d016657a9ed25c1049ec42f1810b230f486a5f3130427614bc7c",
      "12-incident-report.html": "e787d6a64eca1ccd77fd9fa18849400356895ed2717ceb26dad2638fcc3261a9",
      "13-flowchart-diagram.html": "1bd5e80e3363c77b262867a4b03ec39cbc2ce82af88650de5e238407680ff4cf",
      "14-research-feature-explainer.html": "0e701f8fb778bdd05ce5b8f5cd8fbc820f6dfd0d1f258a47c200e7c0d3b6dbe7",
      "15-research-concept-explainer.html": "5dd7d3a3866d123fdea1199a3e20d3a31d6305916013b4a2a4a83018765384b3",
      "16-implementation-plan.html": "e1fa75661822d559550f50a3562f6fdaa0403fd43618726d31866b2ee32eebfc",
      "17-pr-writeup.html": "9ad6ee2d3e7de11d6b1430a01d3ca439771c373af0145f68acbe764a038c8485",
      "18-editor-triage-board.html": "a2a4ba2691c2532dbe67da5bbeb183bbdee5e9027c7006fba6dce18de7347988",
      "19-editor-feature-flags.html": "8fd1aa16175614bea196672cd8f9b119b4ddb5b4768bf0bcb4bb05d6588787ab",
      "20-editor-prompt-tuner.html": "b2e1e46643bb908cb01e73600f40a5506a175869a65ad446992f22eacd0b0877",
    },
  },
};

describe("vendored word for word (ADR-0005, I7, Q6)", () => {
  for (const [dir, pin] of Object.entries(PINNED)) {
    const abs = join(vendor, dir);
    it(`${dir}: every file matches upstream byte for byte at the recorded commit`, () => {
      if (commitOf(abs) !== pin.commit) return; // re-synced: the pins are for another commit
      for (const [file, hash] of Object.entries(pin.files)) expect([file, sha256(join(abs, file))]).toEqual([file, hash]);
    });
  }

  it("show-me folder holds the upstream skill folder and nothing aidw added", () => {
    const files = walk(join(showMe, "show-me")).map((f) => relative(join(showMe, "show-me"), f)).sort();
    expect(files).toEqual(["SKILL.md", "agents/openai.yaml"]);
    expect(readdirSync(showMe).sort()).toEqual(["LICENSE", "UPSTREAM.md", "show-me"]);
  });

  it("show-me still says to open the page with Bash(open ...), which the notes override rather than an edit", () => {
    expect(readFileSync(join(showMe, "show-me", "SKILL.md"), "utf8")).toMatch(/Bash\(open [^)]*\.html\)/);
  });

  it("html-effectiveness folder holds the 20 examples, LICENSE and UPSTREAM.md only", () => {
    const names = readdirSync(htmlEff).sort();
    expect(names.filter((n) => n.endsWith(".html"))).toHaveLength(20);
    expect(names.filter((n) => !n.endsWith(".html"))).toEqual(["LICENSE", "UPSTREAM.md"]);
    expect(names).not.toContain("index.html");
  });
});

describe("vendored-skill-notes.md names what differs under aidw", () => {
  const notes = readFileSync(join(root, "plugins", "aidw", "library", "vendored-skill-notes.md"), "utf8");
  const section = (heading: string) => notes.split(/^## /m).find((s) => s.startsWith(heading)) ?? "";

  it("show-me: names Bash(open ...) and replaces it with a link", () => {
    const s = section("humanlayer/show-me");
    expect(s).toContain("Bash(open ...)");
    expect(s).toMatch(/never open/i);
    expect(s).toMatch(/\blink\b/);
  });
});

// scripts/vendor.mjs run offline: a fake `curl` on PATH serves the vendored files as the upstream.
describe("scripts/vendor.mjs with the two new upstreams", () => {
  const work = mkdtempSync(join(tmpdir(), "aidw-vendor-test-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const sha = "0123456789abcdef0123456789abcdef01234567";

  const bin = join(work, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -H|-A) shift 2;; -*) shift;; *) url="$1"; shift;; esac; done
case "$url" in
  https://api.github.com/*) printf '{"sha":"${sha}"}' ;;
  https://codeload.github.com/*) tar -czf "$out" -C "$FAKE_SRC" upstream ;;
  https://raw.githubusercontent.com/*)
    path=$(printf '%s' "$url" | sed -E 's#^https://raw.githubusercontent.com/[^/]+/[^/]+/[^/]+/##')
    cp "$FAKE_SRC/upstream/$path" "$out" 2>/dev/null || exit 22 ;;
  *) exit 22 ;;
esac
`,
  );
  chmodSync(join(bin, "curl"), 0o755);

  const run = (upstream: string, src: string, cwd: string) =>
    execFileSync("node", [join(root, "scripts", "vendor.mjs"), upstream], {
      cwd,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_SRC: src },
      encoding: "utf8",
    });

  it("html-effectiveness lands in its dest with the 20 files copied verbatim", () => {
    const src = join(work, "src-he");
    mkdirSync(join(src, "upstream"), { recursive: true });
    for (const f of readdirSync(htmlEff)) if (f !== "UPSTREAM.md") cpSync(join(htmlEff, f), join(src, "upstream", f));
    writeFileSync(join(src, "upstream", "index.html"), "<p>not an example</p>");
    const cwd = join(work, "repo-he");
    mkdirSync(cwd);
    run("html-effectiveness", src, cwd);
    const out = join(cwd, "plugins", "aidw", "library", "vendor");
    expect(existsSync(join(out, "html-effectiveness"))).toBe(false);
    const dest = join(out, "anthropics", "html-effectiveness");
    expect(readdirSync(dest).sort()).toEqual(readdirSync(htmlEff).sort());
    for (const f of readdirSync(htmlEff)) if (f !== "UPSTREAM.md") expect([f, sha256(join(dest, f))]).toEqual([f, sha256(join(htmlEff, f))]);
    expect(readFileSync(join(dest, "UPSTREAM.md"), "utf8")).toContain(`Commit: \`${sha}\``);
  });

  it("humanlayer copies plugins/show-me/skills/show-me whole, agents/ included", () => {
    const src = join(work, "src-hl");
    mkdirSync(join(src, "upstream", "plugins", "show-me", "skills"), { recursive: true });
    cpSync(join(showMe, "show-me"), join(src, "upstream", "plugins", "show-me", "skills", "show-me"), { recursive: true });
    cpSync(join(showMe, "LICENSE"), join(src, "upstream", "LICENSE"));
    const cwd = join(work, "repo-hl");
    mkdirSync(cwd);
    run("humanlayer", src, cwd);
    const dest = join(cwd, "plugins", "aidw", "library", "vendor", "humanlayer");
    for (const f of ["LICENSE", "show-me/SKILL.md", "show-me/agents/openai.yaml"])
      expect([f, sha256(join(dest, f))]).toEqual([f, sha256(join(showMe, f))]);
  });

  it("re-syncing the anthropic upstream leaves vendor/anthropics/html-effectiveness alone", () => {
    const src = join(work, "src-an");
    mkdirSync(join(src, "upstream", "skills", "frontend-design"), { recursive: true });
    writeFileSync(join(src, "upstream", "skills", "frontend-design", "SKILL.md"), "# fd\n");
    writeFileSync(join(src, "upstream", "skills", "frontend-design", "LICENSE.txt"), "Apache\n");
    const cwd = join(work, "repo-an");
    const keep = join(cwd, "plugins", "aidw", "library", "vendor", "anthropics", "html-effectiveness", "01-x.html");
    mkdirSync(join(keep, ".."), { recursive: true });
    writeFileSync(keep, "kept");
    run("anthropic", src, cwd);
    expect(readFileSync(keep, "utf8")).toBe("kept");
    expect(existsSync(join(cwd, "plugins", "aidw", "library", "vendor", "anthropic", "frontend-design", "SKILL.md"))).toBe(true);
  });
});
