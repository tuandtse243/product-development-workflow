import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { commitOf } from "../src/deliver.js";
import { pathsFor } from "../src/project.js";
import { tempProject } from "./fixtures.js";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", ...args], { cwd, encoding: "utf8" }).trim();

describe("the commit shown in the delivery task table", () => {
  it("finds a task by its Change and Task trailers, not by the subject", () => {
    const root = tempProject();
    git(root, "init", "-q");
    const commit = (subject: string, change: string, task: string) =>
      git(root, "commit", "-q", "--allow-empty", "-m", `${subject}\n\nChange: ${change}\nTask: ${task}\nEvidence: .aidw/x.json`);
    commit("feat(todos): show done count", "2026-11-14-a", "T01");
    const a1 = git(root, "log", "-1", "--format=%h");
    commit("feat(todos): other change, same task id", "2026-11-15-b", "T01");
    const b1 = git(root, "log", "-1", "--format=%h");
    commit("feat(todos): a longer id", "2026-11-14-a", "T010");

    const p = pathsFor(root);
    expect(commitOf(p, "2026-11-14-a", "T01")).toBe(a1);
    expect(commitOf(p, "2026-11-15-b", "T01")).toBe(b1);
    expect(commitOf(p, "2026-11-14-a", "T02")).toBe("");
    expect(commitOf(p, "2026-11-14-a", "T0")).toBe("");
  });

  it("is empty outside a git repository", () => {
    expect(commitOf(pathsFor(tempProject()), "2026-11-14-a", "T01")).toBe("");
  });
});
