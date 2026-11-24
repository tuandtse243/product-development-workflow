/** Re-review probes of T10 round 2 (D10): what an Agent may still do to the cap. */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decide, type HookInput } from "../src/gate.js";
import { executingProject } from "./run.test.js";

const ID = "2026-11-08-booking";

describe("the cap fixed at approval is out of the Agents' hands (D10)", () => {
  const hook = (root: string, agent_type: string): HookInput => ({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: join(root, ".aidw/changes", ID, "change.yaml") },
    cwd: root,
    agent_type,
  });
  it.each(["aidw:technical-planner", "aidw:business-analyst", "aidw:software-architect"])(
    "denies %s rewriting change.yaml (approval.agent_run_cap) during the build",
    (who) => {
      const root = executingProject();
      expect(decide(hook(root, who), {} as NodeJS.ProcessEnv)?.decision).toBe("deny");
    },
  );
});

describe("a not-built task's partial work is not committed by the next task (D9)", () => {
  it("T02 not built mid-run: its edits in the main checkout do not land in T04's commit", async () => {
    const { execFileSync } = await import("node:child_process");
    const { run } = await import("../src/cli.js");
    const { write } = await import("./fixtures.js");
    const OK = `node -e "process.exit(0)"`;
    const t = (id: string, deps: string, touches: string) =>
      `  - id: ${id}\n    title: Task ${id}\n    role: fullstack-engineer\n    type: feat\n    depends_on: [${deps}]\n    touches: ["${touches}"]\n    verify: ['${OK}']\n    status: pending\n`;
    const SC = "booking/reschedule-appointment/reschedule-appointment-works";
    const root = executingProject({ git: true, tasks: `tasks:\n${t("T02", "", "lib/calendar/**")}${t("T04", "", "lib/mail/**").replace("    status", `    specs: [booking/reschedule-appointment]\n    scenarios: [${SC}]\n    status`)}` });
    write(root, "lib/mail/booking.test.ts", `import { test } from "vitest";\ntest("${SC}: moves it", () => {});\n`);
    const cli = (...argv: string[]) => {
      let err = "";
      const code = run([...argv, "--root", root], {}, root, { out: () => {}, err: (s) => (err += s) });
      return { code, err };
    };
    { const s = cli("task", "start", "T02"); expect(s.code, s.err).toBe(0); }
    write(root, "lib/calendar/half.ts", "export const half = 1;\n"); // the implementer's partial work
    expect(cli("not-built", "T02", "--cause", "environment", "--reason", "no calendar API key in .env").code).toBe(0);
    expect(cli("task", "start", "T04").code).toBe(0);
    write(root, "lib/mail/send.ts", "export const send = 1;\n");
    expect(cli("checkpoint", "T04").code).toBe(0);
    const r = cli("review", "T04", "pass");
    expect(r.code, r.err).toBe(0);
    const files = execFileSync("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: root, encoding: "utf8" });
    expect(files).toContain("lib/mail/send.ts");
    expect(files).not.toContain("lib/calendar/half.ts");
  });
});
