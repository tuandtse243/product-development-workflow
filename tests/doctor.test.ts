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
  return { ok, out: ok ? (cmd === "curl" && key.includes("/json/version") ? '{"Browser":"Chrome/1"}' : "ok-output") : "boom" };
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
    const checks = doctor(pathsFor(root), ID, { E2E_CDP_URL: "http://127.0.0.1:41000" }, probe({}));
    expect(checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(checks.map((c) => c.name)).toEqual(expect.arrayContaining(["pnpm", "chrome cdp", "vercel login", "vercel project", "vercel"]));
  });

  it("fails when a linked Vercel project has no deployment yet (the first one is Production)", () => {
    const root = project();
    write(root, ".vercel/project.json", "{}");
    const none: Probe = (cmd, args) => (cmd === "vercel" && args[0] === "ls" ? { ok: true, out: "No deployments found" } : probe({})(cmd, args, root));
    const by = Object.fromEntries(doctor(pathsFor(root), ID, {}, none).map((c) => [c.name, c]));
    expect(by["vercel deployments"]).toMatchObject({ status: "fail" });
    expect(by["vercel deployments"]?.detail).toMatch(/aidw first-deploy/);
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

  it("has no default CDP port: it asks for the project's test browser, or uses the one recorded or set", () => {
    const root = project();
    const find = (env: NodeJS.ProcessEnv) => doctor(pathsFor(root), ID, env, probe({})).find((c) => c.name === "chrome cdp");
    expect(find({})).toMatchObject({ status: "fail" });
    expect(find({})?.detail).toMatch(/aidw browser start/);
    expect(find({})?.detail).not.toMatch(/9222/);
    expect(find({ E2E_CDP_URL: "http://127.0.0.1:41000" })).toMatchObject({ status: "ok", detail: "http://127.0.0.1:41000" });
    write(root, ".aidw/run/browser.json", JSON.stringify({ port: 42000, url: "http://127.0.0.1:42000", pid: 1, profile: "x", headless: true, started_at: "now" }));
    expect(find({})).toMatchObject({ status: "ok", detail: "http://127.0.0.1:42000" });
  });

  it("fails on an invalid quality.yaml instead of silently skipping every check", () => {
    const root = project();
    write(root, `.aidw/changes/${ID}/quality.yaml`, 'layers:\n  - name: code\n    run: ["node -e 1"]\ndeploy:\n  target: preview\n  command: "vercel deploy --yes"\n');
    const checks = doctor(pathsFor(root), ID, {}, probe({}));
    expect(checks.find((c) => c.name === "quality.yaml")).toMatchObject({ status: "fail" });
    expect(checks.find((c) => c.name === "quality.yaml")?.detail).toMatch(/vercel-preview/);
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

import { productionCommand, firstDeploy } from "../src/firstdeploy.js";

describe("aidw first-deploy", () => {
  it("turns the preview flag into --prod", () => {
    expect(productionCommand("pnpm dlx vercel deploy --yes --environment=preview")).toBe("pnpm dlx vercel deploy --yes --prod");
    expect(productionCommand("vercel deploy --yes")).toBe("vercel deploy --yes --prod");
  });
  it("asks for --yes, deploys only then, and does nothing when a deployment exists", () => {
    const root = project();
    const calls: string[] = [];
    const fake = (empty: boolean) => ((cmd: string, args: string[]) => (calls.push(`${cmd} ${args.join(" ")}`), cmd === "vercel" ? { status: 0, stdout: empty ? "No deployments found" : "dpl_1", stderr: "" } : { status: 0, stdout: "https://x.vercel.app", stderr: "" })) as never;
    const ask = firstDeploy(pathsFor(root), ID, false, fake(true));
    expect(ask).toMatchObject({ needed: true, ran: false, ok: false });
    expect(ask.output).toContain(`aidw first-deploy ${ID} --yes`);
    expect(calls).toEqual(["vercel ls"]);
    expect(firstDeploy(pathsFor(root), ID, true, fake(true))).toMatchObject({ ran: true, ok: true });
    expect(calls.at(-1)).toMatch(/^sh -c .*--prod$/);
    expect(firstDeploy(pathsFor(root), ID, true, fake(false))).toMatchObject({ needed: false, ran: false, ok: true });
  });
});

describe("vercel framework", () => {
  it("warns when a Next.js app has no framework in vercel.json (project saved as Other)", () => {
    const root = project();
    write(root, ".vercel/project.json", "{}");
    write(root, "package.json", JSON.stringify({ dependencies: { next: "15.0.0" } }));
    const w = doctor(pathsFor(root), ID, {}, probe({})).find((c) => c.name === "vercel framework");
    expect(w).toMatchObject({ status: "warn" });
    write(root, "vercel.json", JSON.stringify({ framework: "nextjs" }));
    expect(doctor(pathsFor(root), ID, {}, probe({})).find((c) => c.name === "vercel framework")).toBeUndefined();
  });
});
