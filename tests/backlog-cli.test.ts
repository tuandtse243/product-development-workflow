import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { monorepoSignal } from "../src/detect.js";

function dir(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), "aidw-mono-"));
  for (const [f, c] of Object.entries(files)) writeFileSync(join(d, f), c);
  return d;
}

describe("B1: monorepoSignal reads the workspace file before it warns", () => {
  it("a pnpm-workspace.yaml with settings only is not a monorepo", () => {
    expect(monorepoSignal(dir({ "pnpm-workspace.yaml": "allowBuilds:\n  esbuild: true\n" }))).toBeNull();
    expect(monorepoSignal(dir({ "pnpm-workspace.yaml": "" }))).toBeNull();
    expect(monorepoSignal(dir({ "pnpm-workspace.yaml": "packages: []\n" }))).toBeNull();
  });
  it("a pnpm-workspace.yaml with packages: still is", () => {
    expect(monorepoSignal(dir({ "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\nallowBuilds:\n  esbuild: true\n" }))).toBe("pnpm-workspace.yaml");
  });
  it("package.json workspaces: empty is not, a list or {packages} is", () => {
    expect(monorepoSignal(dir({ "package.json": '{"workspaces": []}' }))).toBeNull();
    expect(monorepoSignal(dir({ "package.json": '{"workspaces": {"packages": []}}' }))).toBeNull();
    expect(monorepoSignal(dir({ "package.json": '{"workspaces": ["apps/*"]}' }))).toBe("package.json workspaces");
    expect(monorepoSignal(dir({ "package.json": '{"workspaces": {"packages": ["apps/*"]}}' }))).toBe("package.json workspaces");
  });
  it("tool files stay a signal", () => {
    expect(monorepoSignal(dir({ "nx.json": "{}" }))).toBe("nx.json");
  });
});
