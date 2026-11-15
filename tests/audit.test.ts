import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLens } from "../src/audit.js";
import { run } from "../src/cli.js";
import { decide } from "../src/gate.js";
import { machineById } from "../src/machine.js";
import { tempProject, write } from "./fixtures.js";

const ID = "2026-11-14-audit";

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}

function audit(lenses = "security,code-quality"): string {
  const root = tempProject();
  cli(root, "init");
  expect(cli(root, "change", "new", ID, "--workflow", "audit", "--title", "Audit the booking app").code).toBe(0);
  write(root, `.aidw/changes/${ID}/intake.md`, "# Intake\n\nAudit the whole project before launch.\n");
  for (const s of ["intake", "analyzing"]) expect(cli(root, "transition", ID, s).code, s).toBe(0);
  if (lenses) expect(cli(root, "decide", "audit-lenses", lenses, "--reason", "launch risk").code).toBe(0);
  return root;
}

const SECURITY = "LENS: security\n## Findings\n- [high] app/api/bookings/route.ts: no authorization check before cancel\n- [low] README.md: secrets example uses a real-looking key\n## Not covered\n- Third-party dependencies (no network)\n";
const QUALITY = "LENS: code-quality\n## Findings\n- [critical] lib/slots.ts: double booking is possible under concurrent requests\n- [medium] lib/format.ts: duplicated date formatting\n## Not covered\nNone\n";

describe("the audit machine", () => {
  it("goes from analyzing straight to delivered and never needs an approval", () => {
    const m = machineById("audit")!;
    expect(m.transitions.analyzing).toEqual(["delivered", "paused", "escalated"]);
    expect(m.approvalRequired.size).toBe(0);
    expect(m.analysisRequired.size).toBe(0);
    expect("executing" in m.transitions).toBe(false);
  });
});

describe("an audit, end to end", () => {
  it("briefs one reviewer per decided lens", () => {
    const root = audit();
    const b = cli(root, "audit", "brief", "security");
    expect(b.out).toMatch(/SPAWN aidw:security with: Audit brief: /);
    const text = readFileSync(b.out.split("\n")[0]!, "utf8");
    expect(text).toMatch(/Audit the whole project before launch/);
    expect(text).toMatch(/audit-security\.md/);
    expect(cli(root, "audit", "brief", "code-quality").out).toMatch(/SPAWN aidw:code-reviewer/);
    expect(cli(root, "audit", "brief", "ui").err).toMatch(/lens "ui" was not decided/);
  });

  it("assembles one report by severity, delivers, archives and hands out the picked findings", () => {
    const root = audit();
    expect(cli(root, "audit", "report").code).toBe(1); // nobody answered yet
    expect(cli(root, "transition", ID, "delivered").err).toMatch(/needs every audit lens answered/);
    write(root, ".aidw/run/audit-security.md", SECURITY);
    write(root, ".aidw/run/audit-code-quality.md", QUALITY);
    const r = cli(root, "audit", "report", "--json").json();
    expect(r.findings.map((f: { id: string; severity: string; lens: string }) => `${f.id} ${f.severity} ${f.lens}`)).toEqual([
      "F-01 critical code-quality",
      "F-02 high security",
      "F-03 medium code-quality",
      "F-04 low security",
    ]);
    const report = readFileSync(join(root, ".aidw/changes", ID, "audit-report.md"), "utf8");
    expect(report).toMatch(/4 finding\(s\): 1 critical, 1 high, 1 medium, 1 low/);
    expect(report).toMatch(/### Critical\n\n- F-01 \[code-quality\] lib\/slots\.ts: double booking/);
    expect(report).toMatch(/- \[security\] Third-party dependencies/);

    expect(cli(root, "audit", "picks", "F-02,F-01").out).toMatch(/- F-02 \[security\] app\/api[\s\S]*- F-01 \[code-quality\] lib\/slots/);
    expect(cli(root, "audit", "picks", "F-09").err).toMatch(/no such finding: F-09/);

    expect(cli(root, "transition", ID, "delivered").code).toBe(0);
    const a = cli(root, "archive", ID);
    expect(a.code, a.err).toBe(0);
    expect(existsSync(join(root, ".aidw/archive", ID, "audit-report.md"))).toBe(true);
  });

  it("refuses a report whose lens answer is malformed", () => {
    const root = audit("security");
    write(root, ".aidw/run/audit-security.md", "LENS: security\n## Findings\n- something is off\n");
    const r = cli(root, "audit", "report");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/must be "- \[critical\|high\|medium\|low\]/);
    expect(r.out).toMatch(/missing section "## Not covered"/);
  });

  it("needs the lenses decided first, and only the decided ones are asked", () => {
    const root = audit("");
    expect(cli(root, "audit", "brief", "security").err).toMatch(/no lenses decided/);
    expect(cli(root, "decide", "audit-lenses", "performance", "--reason", "x").err).toMatch(/"performance" is not an answer of "audit-lenses"/);
    expect(cli(root, "decide", "audit-lenses", "security,ui", "--reason", "x").code).toBe(0);
  });

  it("is refused for a change that is not an audit", () => {
    const root = tempProject();
    cli(root, "init");
    cli(root, "change", "new", "plain");
    expect(cli(root, "audit", "report", "--change", "plain").err).toMatch(/which is not an audit/);
  });
});

describe("an audit changes no code", () => {
  it("keeps the gate closed to project files, and lets a reviewer write only its answer", () => {
    const root = audit();
    const ask = (file: string, agent?: string) => decide({ tool_name: "Write", tool_input: { file_path: join(root, file) }, cwd: root, ...(agent ? { agent_type: agent } : {}) }, {});
    expect(ask("app/api/bookings/route.ts")?.decision).toBe("deny");
    expect(ask(".aidw/run/audit-security.md", "aidw:security")?.decision).toBe("allow");
    expect(ask(".aidw/run/audit-ui.md", "aidw:ui-ux-designer")?.decision).toBe("allow");
    expect(ask("app/api/bookings/route.ts", "aidw:security")?.decision).toBe("deny");
    expect(ask(".aidw/run/notes.md", "aidw:security")?.decision).toBe("deny");
  });
});

describe("parseLens", () => {
  it("reads findings with their severity, and None", () => {
    const r = parseLens(SECURITY, "security", "f");
    expect(r.diags.errors).toEqual([]);
    expect(r.findings).toEqual([
      { severity: "high", lens: "security", text: "app/api/bookings/route.ts: no authorization check before cancel" },
      { severity: "low", lens: "security", text: "README.md: secrets example uses a real-looking key" },
    ]);
    expect(parseLens("LENS: ui\n## Findings\nNone\n## Not covered\nNone\n", "ui", "f").diags.errors).toEqual([]);
  });

  it("rejects a wrong lens line", () => {
    expect(parseLens(SECURITY, "ui", "f").diags.errors.map((e) => e.message).join()).toMatch(/must be exactly "LENS: ui"/);
  });
});

describe("a lens answer left by an earlier audit", () => {
  it("is removed when the brief for that lens is made, so it cannot pass for the new audit's answer", () => {
    const root = audit();
    write(root, ".aidw/run/audit-security.md", SECURITY); // left by an earlier audit
    expect(cli(root, "audit", "brief", "security", "--change", ID).code).toBe(0);
    expect(existsSync(join(root, ".aidw/run/audit-security.md"))).toBe(false);
  });
});
