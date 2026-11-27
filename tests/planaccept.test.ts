import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { planAdvice, planAdviceAccepted } from "../src/plan.js";
import { planGateSection } from "../src/planrefs.js";
import { pathsFor } from "../src/project.js";
import { validateTasksText } from "../src/tasks.js";
import type { Task } from "../src/tasks.js";
import { tempProject } from "./fixtures.js";

const scen = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}/s${i}`);
const WHY_DEP = "T03's 409 tests need T01's trigger";
const WHY_BIG = "every scenario goes through editBooking";

/** The trial's shape: T03 depends on T01 without sharing files, and T03 carries 28 of 83 scenarios. */
function plan(accept?: unknown[]): Task[] {
  const t = (id: string, touches: string[], depends_on: string[], n: number, extra: Record<string, unknown> = {}) =>
    ({ id, title: id, role: "fullstack", type: "feat", touches, verify: ["x"], depends_on, scenarios: scen(n, id), ...extra }) as Task;
  return [
    t("T01", ["lib/trigger/**"], [], 20),
    t("T02", ["app/list/**"], ["T01"], 15),
    t("T03", ["app/booking/**"], ["T01"], 28, accept ? { accept } : {}),
    t("T04", ["app/ui/**"], ["T02", "T03"], 10),
    t("T05", ["e2e/**"], ["T04"], 10),
  ];
}

describe("plan warning codes and accept:", () => {
  it("without accept: both warnings stay WARN", () => {
    const r = planAdviceAccepted(plan());
    expect(r.warnings.some((w) => /depends_on without overlapping touches: .*T03 on T01/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /T03 \(28 of 83 scenarios\) carry a third/.test(w))).toBe(true);
    expect(r.accepted).toEqual([]);
    expect(r.stale).toEqual([]);
    expect(planAdvice(plan())).toEqual(r.warnings);
  });

  it("with accept: INFO with the reason and no WARN for what it covers", () => {
    const r = planAdviceAccepted(
      plan([
        { warn: "depends-without-overlap", on: "T01", why: WHY_DEP },
        { warn: "large-task", why: WHY_BIG },
      ]),
    );
    expect(r.accepted).toHaveLength(2);
    expect(r.accepted[0]).toMatch(/^accepted: .*T03 on T01.*: T03's 409 tests need T01's trigger$/);
    expect(r.accepted[1]).toMatch(/^accepted: task\(s\) T03 \(28 of 83 scenarios\) carry a third.*: every scenario goes through editBooking$/);
    expect(r.warnings.some((w) => /T03 \(28/.test(w))).toBe(false);
    // the other pairs of the same warning are still a WARN, without the accepted one
    const rest = r.warnings.find((w) => /depends_on without overlapping/.test(w)) ?? "";
    expect(rest).not.toMatch(/T03 on T01/);
    expect(rest).toMatch(/T02 on T01/);
  });

  it("an accept that matches no warning is a WARN of its own", () => {
    const r = planAdviceAccepted(plan([{ warn: "catch-all-touches", why: "no longer true" }]));
    expect(r.stale).toEqual(["accept on T03 matches no warning (catch-all-touches): remove it"]);
  });

  it("a bad accept entry is an ERROR", () => {
    const check = (accept: unknown[]) => {
      const text = JSON.stringify({ tasks: plan(accept) });
      return validateTasksText(text, "tasks.yaml").errors.map((e) => e.message);
    };
    expect(check([{ warn: "no-such-code", why: "x" }]).join("\n")).toMatch(/unknown warning code "no-such-code"/);
    expect(check([{ warn: "large-task" }]).join("\n")).toMatch(/needs a "why"/);
    expect(check([{ warn: "large-task", why: "  " }]).join("\n")).toMatch(/needs a "why"/);
    expect(check([{ warn: "depends-without-overlap", on: "T99", why: "x" }]).join("\n")).toMatch(/unknown task "T99"/);
    expect(check([{ warn: "large-task", why: WHY_BIG }])).toEqual([]);
  });

  it("the gate plan section lists the accepted warnings with their reasons", () => {
    const root = tempProject();
    const s = planGateSection(pathsFor(root), plan([{ warn: "large-task", why: WHY_BIG }]), join(root, ".aidw/run/pages"));
    expect(s.points.some((x) => /^accepted: task\(s\) T03 .*: every scenario goes through editBooking$/.test(x))).toBe(true);
  });
});
