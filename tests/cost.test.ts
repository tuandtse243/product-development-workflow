import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { formatCost, projectSlug, readSessions, readTranscript, weighted } from "../src/cost.js";
import { tempProject } from "./fixtures.js";

const usage = (input: number, read: number, write: number, output: number) => ({
  input_tokens: input,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  output_tokens: output,
});

/** Claude Code writes one line per content block: the same message id and usage repeat on each line. */
const reply = (id: string, u: ReturnType<typeof usage>, blocks: unknown[], at = "2026-11-10T05:00:00.000Z") =>
  blocks.map((b, i) => JSON.stringify({ type: "assistant", uuid: `${id}-${i}`, timestamp: at, message: { id, usage: u, content: [b] } })).join("\n");

const tool = (id: string, name: string, input: Record<string, unknown> = {}) => ({ type: "tool_use", id, name, input });

function transcripts() {
  const home = mkdtempSync(join(tmpdir(), "aidw-cost-"));
  const project = tempProject();
  const dir = join(home, "projects", projectSlug(project));
  mkdirSync(join(dir, "s1", "subagents"), { recursive: true });
  const main = [
    reply("m1", usage(10, 50_000, 5_000, 200), [{ type: "text", text: "hi" }, tool("t1", "Bash", { command: "aidw task start T01 && echo x" })]),
    reply("m2", usage(5, 60_000, 1_000, 100), [tool("t2", "Agent"), tool("t3", "Agent")]),
    reply("m3", usage(5, 300_000, 2_000, 300), [tool("t4", "Bash", { command: "aidw next --change a; aidw checkpoint T01" })]),
  ].join("\n");
  writeFileSync(join(dir, "s1.jsonl"), `${main}\n`);
  writeFileSync(join(dir, "s1", "subagents", "agent-a.jsonl"), `${reply("s1m1", usage(1, 20_000, 3_000, 500), [{ type: "text", text: "done" }])}\n`);
  return { home, project };
}

describe("readTranscript", () => {
  it("counts a reply once however many content blocks it was written as", () => {
    const { home, project } = transcripts();
    const t = readTranscript(join(home, "projects", projectSlug(project), "s1.jsonl"));
    expect(t.turns).toBe(3);
    expect(t.usage).toEqual({ input: 20, output: 600, cacheRead: 410_000, cacheWrite: 8_000 });
    expect(t.contextFirst).toBe(55_010);
    expect(t.contextMax).toBe(302_005);
    expect(t.tools).toEqual({ Bash: 2, Agent: 2 });
    expect(t.aidwCommands).toEqual({ "task start": 1, next: 1, checkpoint: 1 });
  });
});

describe("aidw cost", () => {
  it("adds subagents, flags the repeated spawn and the long session", () => {
    const { home, project } = transcripts();
    const sessions = readSessions(project, { HOME: home, CLAUDE_CONFIG_DIR: home });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: "s1", turns: 3, repeatedSpawns: 1 });
    expect(sessions[0]?.subagents).toMatchObject({ count: 1, turns: 1 });
    const text = formatCost(sessions);
    expect(text).toMatch(/3 turns, context 55K -> 302K/);
    expect(text).toMatch(/1 subagent\(s\), 1 turns/);
    expect(text).toMatch(/1 Agent call\(s\) sent twice/);
    expect(text).toMatch(/grew to 302K per turn/);
  });

  it("weighs cache reads cheap and output expensive", () => {
    expect(weighted({ input: 1000, output: 100, cacheRead: 10_000, cacheWrite: 400 })).toBe(1000 + 500 + 1000 + 500);
  });

  it("runs as a command and says so when there is nothing to read", () => {
    const { home, project } = transcripts();
    let out = "";
    const env = { HOME: home, CLAUDE_CONFIG_DIR: home } as NodeJS.ProcessEnv;
    run(["init", "--root", project], env, project, { out: () => {}, err: () => {} });
    expect(run(["cost", "--root", project], env, project, { out: (s) => (out += s), err: () => {} })).toBe(0);
    expect(out).toMatch(/session s1/);
    out = "";
    run(["cost", "--root", project, "--session", "zzz"], env, project, { out: (s) => (out += s), err: () => {} });
    expect(out).toMatch(/no Claude Code transcripts/);
  });
});
