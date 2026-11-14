import { beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { run } from "../src/cli.js";
import { agentForTask, implementerOf } from "../src/roles.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, tempProject, write } from "./fixtures.js";

const plugin = join(__dirname, "..", "plugins", "aidw");
const ID = "booking-v2";

describe("which Agent runs a task", () => {
  it("is the Role of the task when it writes code, or the Role that carries it", () => {
    expect(implementerOf(plugin, "frontend")).toBe("frontend");
    expect(implementerOf(plugin, "backend")).toBe("backend");
    expect(implementerOf(plugin, "fullstack")).toBe("fullstack");
    expect(implementerOf(plugin, "database")).toBe("database"); // activated: it runs its own tasks
    expect(implementerOf(plugin, "devops")).toBe("devops"); // activated: it runs its own tasks
    expect(implementerOf(plugin, "integration")).toBe("fullstack");
  });

  it("is nobody for a role that cannot write project files or does not exist", () => {
    for (const r of ["code-reviewer", "product-manager", "qa", "no-such-role", undefined]) expect(implementerOf(plugin, r), String(r)).toBeNull();
  });

  it("falls back to the default implementer, so an unknown role still runs", () => {
    expect(agentForTask(plugin, "frontend")).toBe("aidw:frontend");
    expect(agentForTask(plugin, "database")).toBe("aidw:database");
    expect(agentForTask(plugin, "devops")).toBe("aidw:devops");
    expect(agentForTask(plugin, "integration")).toBe("aidw:fullstack"); // planned, carried by fullstack
    expect(agentForTask(plugin, "no-such-role")).toBe("aidw:fullstack");
  });
});

describe("a plan with a role that cannot run tasks", () => {
  let root: string;
  const cli = (...argv: string[]) => {
    let out = "";
    run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: () => undefined });
    return (out.trim().startsWith("{") ? JSON.parse(out) : {}) as { warnings: { message: string }[] };
  };
  beforeEach(() => {
    root = tempProject();
    cli("init");
    write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
    cli("change", "new", ID);
    write(root, `.aidw/changes/${ID}/analysis.md`, ANALYSIS_MD);
    write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
    write(root, `.aidw/changes/${ID}/quality.yaml`, QUALITY_YAML);
    write(root, `.aidw/changes/${ID}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  });

  it("warns, and says fullstack will run it", () => {
    write(root, `.aidw/changes/${ID}/tasks.yaml`, TASKS_YAML.replace(/role: \S+/, "role: code-reviewer"));
    const w = cli("analyze", ID, "--json").warnings.map((x) => x.message).join("\n");
    expect(w).toMatch(/task T01: role "code-reviewer" cannot run a task .* fullstack will run it/);
  });

  it("is silent for frontend, backend and a planned role carried by fullstack", () => {
    for (const role of ["frontend", "backend", "database", "devops", "integration"]) {
      write(root, `.aidw/changes/${ID}/tasks.yaml`, TASKS_YAML.replace(/role: \S+/g, `role: ${role}`));
      expect(cli("analyze", ID, "--json").warnings.map((x) => x.message).join("\n"), role).not.toMatch(/cannot run a task/);
    }
  });
});
