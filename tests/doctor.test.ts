import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { binaryOf, doctor, doctorText, type Probe } from "../src/doctor.js";
import { pathsFor } from "../src/project.js";
import { tempProject, write } from "./fixtures.js";

const ID = "2026-11-12-doc";
const Q = `layers:
  - name: code
    run: ["pnpm lint", "pnpm exec tsc --noEmit"]
  - name: e2e
    run: ["PLAYWRIGHT_JUNIT_OUTPUT_NAME=x.xml pnpm exec playwright test --project=e2e"]
deploy:
  target: preview
  command: vercel deploy --yes --environment=preview
  smoke: ["vercel curl / --deployment $AIDW_DEPLOY_URL"]
permissions: [vercel-preview]
`;

function project(): string {
  const root = tempProject();
  run(["init", "--root", root], {}, root, { out: () => {}, err: () => {} });
  run(["change", "new", ID, "--root", root], {}, root, { out: () => {}, err: () => {} });
  write(root, `.aidw/changes/${ID}/quality.yaml`, Q);
  return root;
}

const probe = (answers: Record<string, boolean>): Probe => (cmd, args) => {
  const key = [cmd, ...args].join(" ");
  const hit = Object.keys(answers).find((k) => key.startsWith(k));
  const ok = hit ? (answers[hit] as boolean) : true;
  return { ok, out: ok ? (cmd === "curl" && key.includes("9222") ? '{"Browser":"Chrome/1"}' : "ok-output") : "boom" };
};

describe("binaryOf", () => {
  it("finds the program a layer command really needs", () => {
    expect(binaryOf("PLAYWRIGHT_JUNIT_OUTPUT_NAME=x.xml pnpm exec playwright test")).toEqual({ bin: "pnpm", sub: "playwright" });
    expect(binaryOf("! git grep foo")).toBeNull();
    expect(binaryOf("vercel deploy --yes")).toEqual({ bin: "vercel" });
    expect(binaryOf("npx --no-install vitest run")).toEqual({ bin: "npx", sub: "vitest" });
  });
});

describe("aidw doctor", () => {
  it("passes when the machine has everything", () => {
    const root = project();
    write(root, ".vercel/project.json", "{}");
    const checks = doctor(pathsFor(root), ID, {}, probe({}));
    expect(checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(checks.map((c) => c.name)).toEqual(expect.arrayContaining(["pnpm", "chrome cdp", "vercel login", "vercel project", "vercel"]));
  });

  it("fails on a closed CDP port, a missing login and warns about an unlinked project", () => {
    const root = project();
    const checks = doctor(pathsFor(root), ID, {}, probe({ "curl -sS -m 5": false, vercel: false }));
    const by = Object.fromEntries(checks.map((c) => [c.name, c]));
    expect(by["chrome cdp"]).toMatchObject({ status: "fail" });
    expect(by["vercel login"]).toMatchObject({ status: "fail" });
    expect(by["vercel project"]).toMatchObject({ status: "warn" });
    expect(doctorText(checks)).toMatch(/FAIL chrome cdp[\s\S]*problem\(s\) to fix/);
  });

  it("is a CLI command with a failing exit code", () => {
    const root = project();
    write(root, `.aidw/changes/${ID}/quality.yaml`, 'layers:\n  - name: code\n    run: ["node -e 1"]\n  - name: e2e\n    run: ["node -e 1"]\ndeploy:\n  target: none\n');
    let out = "";
    const code = run(["doctor", ID, "--json", "--root", root], { E2E_CDP_URL: "http://127.0.0.1:1" }, root, { out: (s) => (out += s), err: () => {} });
    const r = JSON.parse(out) as { ok: boolean; checks: { name: string; status: string }[] };
    expect(r.checks.some((c) => c.name === "node")).toBe(true);
    expect(r.checks.find((c) => c.name === "chrome cdp")?.status).toBe("fail");
    expect(code).toBe(1);
  });
});
