import { describe, expect, it } from "vitest";
import { planAdvice, planInfo, planShape } from "../src/plan.js";
import type { Task } from "../src/tasks.js";

const t = (id: string, touches: string[], depends_on: string[] = [], extra: Record<string, unknown> = {}): Task =>
  ({ id, title: id, touches, depends_on, ...extra }) as Task;

describe("planShape", () => {
  it("levels and width of a diamond", () => {
    const s = planShape([t("T01", ["lib/**"]), t("T02", ["app/api/**"], ["T01"]), t("T03", ["app/ui/**"], ["T01"]), t("T04", ["e2e/**"], ["T02", "T03"])]);
    expect(s.levels).toEqual([["T01"], ["T02", "T03"], ["T04"]]);
    expect(s.width).toBe(2);
  });

  it("ignores tasks aidw added itself", () => {
    const s = planShape([t("T01", ["a/**"]), t("Q01", ["**"], [], { origin: "quality" }), t("C01", ["**"], [], { origin: "converge" })]);
    expect(s.tasks).toBe(1);
    expect(s.catchAll).toEqual([]);
  });
});

describe("planAdvice", () => {
  it("warns about a chain whose touches do not overlap, naming the droppable dependencies", () => {
    const advice = planAdvice([
      t("T01", ["lib/**"]),
      t("T02", ["app/api/**"], ["T01"]),
      t("T03", ["app/ui/**"], ["T02"]),
      t("T04", ["e2e/**"], ["T03"]),
    ]);
    expect(advice).toHaveLength(1);
    expect(advice[0]).toMatch(/one dependency chain/);
    expect(advice[0]).toMatch(/T02 after T01, T03 after T02, T04 after T03/);
    expect(advice[0]).toMatch(/vertical feature/);
  });

  it("says nothing for a plan that already has parallel slices", () => {
    expect(
      planAdvice([t("T01", ["a/**"]), t("T02", ["b/**"]), t("T03", ["c/**"]), t("T04", ["d/**"], ["T01", "T02", "T03"])]),
    ).toEqual([]);
  });

  it("says nothing for a short chain (nothing worth splitting)", () => {
    expect(planAdvice([t("T01", ["a/**"]), t("T02", ["b/**"], ["T01"]), t("T03", ["c/**"], ["T02"])])).toEqual([]);
  });

  it("keeps a chain whose touches overlap without telling the user to drop dependencies", () => {
    const advice = planAdvice([t("T01", ["app/**"]), t("T02", ["app/page.tsx"], ["T01"]), t("T03", ["app/**"], ["T02"]), t("T04", ["app/**"], ["T03"])]);
    expect(advice[0]).toMatch(/one dependency chain/);
    expect(advice[0]).not.toMatch(/drop its depends_on/);
  });

  it("flags a catch-all touches glob", () => {
    const advice = planAdvice([t("T01", ["a/**"]), t("T02", ["b/**"]), t("T03", ["c/**"]), t("T04", ["**"])]);
    expect(advice.join(" ")).toMatch(/T04 touch "\*\*"/);
  });
});

describe("heavy tasks and the summary line", () => {
  const sc = (n: number) => Array.from({ length: n }, (_, i) => `a/b/s${i}`);
  it("warns about a task carrying a third of the scenarios", () => {
    const advice = planAdvice([
      t("T01", ["a/**"], [], { scenarios: sc(2) }),
      t("T02", ["b/**"], ["T01"], { scenarios: sc(10) }),
      t("T03", ["c/**"], ["T01"], { scenarios: sc(2) }),
      t("T04", ["d/**"], ["T02", "T03"], { scenarios: sc(2) }),
    ]);
    expect(advice.join("\n")).toMatch(/T02 \(10 of 16 scenarios\) carry a third of the plan/);
  });
  it("summarizes stages and the widest one", async () => {
    const { planSummary } = await import("../src/plan.js");
    expect(planSummary([t("T01", ["a/**"]), t("T02", ["b/**"], ["T01"]), t("T03", ["c/**"], ["T01"])])).toBe("3 task(s) in 2 stage(s), widest stage 2: T01 -> T02+T03");
  });
});

describe("planInfo (waves the dependency graph allows but a wave cannot run)", () => {
  const trial = () => [
    t("T01", ["a/**"], [], { risk: "high" }),
    t("T02", ["b/**"]),
    t("T03", ["c/**"], ["T01", "T02"], { risk: "high" }),
    t("T04", ["d/**"], ["T02"]),
    t("T05", ["e/**"], ["T03", "T04"]),
  ];

  it("names the high-risk task that makes ready tasks run one after the other", () => {
    expect(planInfo(trial(), 3)).toEqual([
      "T01 is risk high: it runs alone, so T01 and T02 run one after the other",
      "T03 is risk high: it runs alone, so T03 and T04 run one after the other",
    ]);
  });

  it("says nothing without a high-risk task or an overlap, or when parallel.max is 1", () => {
    const calm = [t("T01", ["a/**"]), t("T02", ["b/**"]), t("T03", ["c/**"], ["T01", "T02"])];
    expect(planInfo(calm, 3)).toEqual([]);
    expect(planInfo(trial(), 1)).toEqual([]);
  });

  it("reports a split by overlapping touches", () => {
    expect(planInfo([t("T01", ["a/**"]), t("T02", ["a/x/**"])], 3)).toEqual(["T02 and T01 touch the same files, so they run one after the other"]);
  });
});
