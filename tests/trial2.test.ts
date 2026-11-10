/** Regressions found in the second real run (blueprint section 29). */
import { describe, expect, it } from "vitest";
import { unexpectedChanges } from "../src/backstop.js";
import { closedReason, type GateState } from "../src/gate.js";
import { ASK_COMMANDS, firstMatch, maskQuotedAngles, TIER2_COMMANDS, WRITE_COMMANDS } from "../src/policy.js";
import { deployHint, deploymentUrl } from "../src/quality.js";

const writes = (c: string) => firstMatch(WRITE_COMMANDS, maskQuotedAngles(c))?.why ?? null;

describe("redirects inside quotes", () => {
  it("does not read < or > inside quoted arguments as a redirect", () => {
    expect(writes(`timeout 20 "$B" --headless --dump-dom 'data:text/html,<p>ok</p>' 2>&1 | tail -3`)).toBeNull();
    expect(writes(`node -e "console.log(1 > 0)"`)).toBeNull();
    expect(writes(`grep -n "a>b" f`)).toBeNull();
  });
  it("still sees real redirects, also with quoted targets", () => {
    expect(writes(`echo "<p>" > src/a.html`)).toBe("redirects output into a file");
    expect(writes(`echo x > "src/a b.ts"`)).toBe("redirects output into a file");
    expect(writes(`echo x > "$TMPDIR/x"`)).toBeNull();
    expect(writes(`echo "it's \\"<x>\\"" >> notes.md`)).toBe("redirects output into a file");
  });
});

describe("vercel production flags", () => {
  const tier3 = (c: string) => Boolean(firstMatch(ASK_COMMANDS, c));
  it("treats --environment/--target production as production", () => {
    expect(tier3("vercel deploy --yes --environment=production")).toBe(true);
    expect(tier3("vercel deploy --yes --environment production")).toBe(true);
    expect(tier3("npx vercel deploy --target=production")).toBe(true);
    expect(tier3("vercel deploy --yes --environment=preview")).toBe(false);
  });
  it("accepts the recommended preview command as tier 2", () => {
    expect(firstMatch(TIER2_COMMANDS, "vercel deploy --yes --environment=preview")?.resource).toBe("vercel-preview");
  });
});

describe("deployment URL", () => {
  it("prefers Vercel's JSON deployment url over the production alias", () => {
    const out = [
      "{",
      '  "status": "ok",',
      '  "deployment": {',
      '    "id": "dpl_1",',
      '    "url": "https://app-abc123-team.vercel.app",',
      '    "productionUrl": "https://app.vercel.app",',
      '    "inspectorUrl": "https://vercel.com/team/app/1"',
      "  }",
      "}",
      "  Production      https://app-abc123-team.vercel.app",
      "▲ Aliased         https://app.vercel.app",
    ].join("\n");
    expect(deploymentUrl(out)).toBe("https://app-abc123-team.vercel.app");
  });
  it("skips dashboard links and alias lines in plain output", () => {
    expect(deploymentUrl("Inspect: https://vercel.com/t/a/1\nPreview: https://a-1.vercel.app\nAliased https://a.vercel.app\n")).toBe(
      "https://a-1.vercel.app",
    );
    expect(deploymentUrl("Website draft URL: https://abc--site.netlify.app\n")).toBe("https://abc--site.netlify.app");
    expect(deploymentUrl("nothing here")).toBeNull();
  });
});

describe("closed gate reasons", () => {
  const st = (summary: string): GateState => ({ open: false, drift: [], frozen: [], delivered: false, summary });
  it("says the run is stopped, not unapproved, when escalated or paused", () => {
    expect(closedReason(st("app=escalated"))).toMatch(/the run is stopped \(app=escalated\)/);
    expect(closedReason(st("app=paused"))).toMatch(/the run is stopped/);
    expect(closedReason(st("app=analyzing"))).toMatch(/not approved yet/);
  });
  it("baseline paths are never unexpected", () => {
    expect(unexpectedChanges([".gitignore", "x.ts"], [".gitignore"])).toEqual(["x.ts"]);
  });
});

describe("deploy hints", () => {
  it("explains the Vercel token refresh blocked by the sandbox", () => {
    expect(deployHint('Error: The value of "err" is out of range. It must be a negative integer. Received 1')).toMatch(/vercel whoami/);
    expect(deployHint("Error: No existing credentials found. Please run `vercel login`")).toMatch(/vercel login/);
    expect(deployHint("Build failed")).toBeNull();
  });
});
