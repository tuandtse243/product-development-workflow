/**
 * `aidw cost`: where the tokens of a project's Claude Code sessions went (decision D-32).
 *
 * Reads the transcripts Claude Code keeps under ~/.claude/projects/<project>/ (one file per session, plus
 * subagents/ for the subagents each session spawned). Nothing is sent anywhere.
 *
 * A transcript writes one line per content block, so one model reply appears several times with the same
 * `message.id` and the same usage; summing lines would double count. Usage is taken once per message id.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AGENTS } from "./roles.js";

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

export function addUsage(a: Usage, b: Usage): Usage {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}

/**
 * One number to compare runs by: input-equivalent tokens, using the usual price ratios (cache read 0.1x,
 * cache write 1.25x, output 5x of an input token). An estimate for comparing before and after, not an invoice.
 */
export const weighted = (u: Usage): number => Math.round(u.input + u.cacheWrite * 1.25 + u.cacheRead * 0.1 + u.output * 5);

export interface Transcript {
  file: string;
  turns: number;
  usage: Usage;
  /** prompt size of the first, the largest and the average turn (input + cache read + cache write) */
  contextFirst: number;
  contextMax: number;
  contextAvg: number;
  tools: Record<string, number>;
  /** `aidw <subcommand>` calls made through Bash */
  aidwCommands: Record<string, number>;
  firstAt: string | null;
  lastAt: string | null;
}

interface Line {
  type?: string;
  uuid?: string;
  timestamp?: string;
  message?: { id?: string; content?: unknown; usage?: Record<string, number> };
}

const AIDW_CALL = /(?:^|[\s;&|(/])aidw\s+([a-z][a-z-]*(?:\s+(?:start|retry))?)/g;

export function readTranscript(file: string): Transcript {
  const byMessage = new Map<string, Usage & { ctx: number }>();
  const tools: Record<string, number> = {};
  const aidwCommands: Record<string, number> = {};
  const seenTool = new Set<string>();
  let firstAt: string | null = null;
  let lastAt: string | null = null;

  for (const raw of readFileSync(file, "utf8").split("\n")) {
    if (!raw.trim()) continue;
    let line: Line;
    try {
      line = JSON.parse(raw) as Line;
    } catch {
      continue;
    }
    if (line.timestamp) {
      firstAt ??= line.timestamp;
      lastAt = line.timestamp;
    }
    if (line.type !== "assistant" || !line.message) continue;
    const u = line.message.usage;
    if (u) {
      const input = u.input_tokens ?? 0;
      const cacheRead = u.cache_read_input_tokens ?? 0;
      const cacheWrite = u.cache_creation_input_tokens ?? 0;
      // the last line of a message carries its final usage
      byMessage.set(line.message.id ?? line.uuid ?? String(byMessage.size), { input, output: u.output_tokens ?? 0, cacheRead, cacheWrite, ctx: input + cacheRead + cacheWrite });
    }
    const content = line.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as { type?: string; id?: string; name?: string; input?: { command?: unknown } }[]) {
      if (block.type !== "tool_use" || !block.name) continue;
      if (block.id) {
        if (seenTool.has(block.id)) continue;
        seenTool.add(block.id);
      }
      tools[block.name] = (tools[block.name] ?? 0) + 1;
      if (block.name === "Bash" && typeof block.input?.command === "string") {
        for (const m of block.input.command.matchAll(AIDW_CALL)) {
          const sub = (m[1] as string).trim();
          aidwCommands[sub] = (aidwCommands[sub] ?? 0) + 1;
        }
      }
    }
  }

  let usage = emptyUsage();
  let max = 0;
  let sum = 0;
  let first = 0;
  let i = 0;
  for (const m of byMessage.values()) {
    usage = addUsage(usage, m);
    if (i === 0) first = m.ctx;
    max = Math.max(max, m.ctx);
    sum += m.ctx;
    i++;
  }
  return { file, turns: byMessage.size, usage, contextFirst: first, contextMax: max, contextAvg: i ? Math.round(sum / i) : 0, tools, aidwCommands, firstAt, lastAt };
}

export interface SessionCost extends Transcript {
  id: string;
  subagents: { count: number; turns: number; usage: Usage; /** by agent type (aidw:fullstack ...) */ roles: Record<string, { count: number; turns: number; usage: Usage; firstContext: number }> };
  /** Agent tool calls beyond the subagents that actually ran: a plugin hook rewrote the call and it was sent twice */
  repeatedSpawns: number;
}

/** Claude Code names a project's transcript folder after its path, every non-alphanumeric character as "-". */
export const projectSlug = (projectDir: string): string => projectDir.replace(/[^A-Za-z0-9]/g, "-");

export function claudeHome(env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude");
}

export function transcriptDir(projectDir: string, env: NodeJS.ProcessEnv): string {
  return join(claudeHome(env), "projects", projectSlug(projectDir));
}

export function readSessions(projectDir: string, env: NodeJS.ProcessEnv): SessionCost[] {
  const dir = transcriptDir(projectDir, env);
  if (!existsSync(dir)) return [];
  const out: SessionCost[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const id = name.slice(0, -".jsonl".length);
    const main = readTranscript(join(dir, name));
    if (main.turns === 0) continue;
    const subDir = join(dir, id, "subagents");
    let subs: SessionCost["subagents"] = { count: 0, turns: 0, usage: emptyUsage(), roles: {} };
    if (existsSync(subDir)) {
      for (const f of readdirSync(subDir)) {
        if (!f.endsWith(".jsonl")) continue;
        const t = readTranscript(join(subDir, f));
        if (t.turns === 0) continue;
        let role = "subagent";
        try {
          role = String((JSON.parse(readFileSync(join(subDir, f.replace(/\.jsonl$/, ".meta.json")), "utf8")) as { agentType?: string }).agentType ?? role);
        } catch {
          /* no meta file: counted as a plain subagent */
        }
        const r = subs.roles[role] ?? { count: 0, turns: 0, usage: emptyUsage(), firstContext: 0 };
        subs.roles[role] = { count: r.count + 1, turns: r.turns + t.turns, usage: addUsage(r.usage, t.usage), firstContext: r.firstContext + t.contextFirst };
        subs = { count: subs.count + 1, turns: subs.turns + t.turns, usage: addUsage(subs.usage, t.usage), roles: subs.roles };
      }
    }
    out.push({ ...main, id, subagents: subs, repeatedSpawns: Math.max(0, (main.tools.Agent ?? 0) - subs.count) });
  }
  return out.sort((a, b) => (a.firstAt ?? "").localeCompare(b.firstAt ?? ""));
}

export const kilo = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));

/** Plain-text report: one block per session, then the totals and what to do about them. */
/** Wall time the parallel waves saved: the tasks' own durations added up against the time they actually covered. */
export function parallelSavings(tasks: Record<string, unknown>[]): { wave: number; serialMs: number; wallMs: number } | null {
  const iv = tasks
    .filter((t) => typeof t.merged_at === "string" || t.merged_at instanceof Date)
    .map((t) => [new Date(String(t.started_at)).getTime(), new Date(String(t.finished_at)).getTime()] as const)
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a)
    .sort((x, y) => x[0] - y[0]);
  if (!iv.length) return null;
  const serialMs = iv.reduce((n, [a, b]) => n + (b - a), 0);
  let wallMs = 0;
  let [cs, ce] = iv[0] as readonly [number, number];
  for (const [a, b] of iv.slice(1)) {
    if (a <= ce) ce = Math.max(ce, b);
    else {
      wallMs += ce - cs;
      [cs, ce] = [a, b];
    }
  }
  wallMs += ce - cs;
  return { wave: iv.length, serialMs, wallMs };
}

export function formatCost(sessions: SessionCost[]): string {
  if (!sessions.length) return "no Claude Code transcripts found for this project\n";
  const lines: string[] = [];
  let main = emptyUsage();
  let subs = emptyUsage();
  let turns = 0;
  let subTurns = 0;
  let spawns = 0;
  let repeated = 0;
  for (const s of sessions) {
    main = addUsage(main, s.usage);
    subs = addUsage(subs, s.subagents.usage);
    turns += s.turns;
    subTurns += s.subagents.turns;
    spawns += s.subagents.count;
    repeated += s.repeatedSpawns;
    const top = Object.entries(s.aidwCommands).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(", ");
    lines.push(
      `session ${s.id.slice(0, 8)}  ${s.firstAt?.slice(0, 16).replace("T", " ") ?? "?"}`,
      `  ${s.turns} turns, context ${kilo(s.contextFirst)} -> ${kilo(s.contextMax)} (average ${kilo(s.contextAvg)}), cache read ${kilo(s.usage.cacheRead)}, output ${kilo(s.usage.output)}`,
      `  ${s.subagents.count} subagent(s), ${s.subagents.turns} turns, cache read ${kilo(s.subagents.usage.cacheRead)}${s.repeatedSpawns ? `; ${s.repeatedSpawns} Agent call(s) sent twice` : ""}`,
      ...(top ? [`  aidw calls: ${top}`] : []),
    );
  }
  const wMain = weighted(main);
  const wSubs = weighted(subs);
  const total = wMain + wSubs;
  const share = total ? Math.round((wMain / total) * 100) : 0;
  lines.push(
    "",
    `total: ${sessions.length} session(s), ${turns} orchestrator turns + ${subTurns} subagent turns (${spawns} subagents)`,
    `  weighted cost ${kilo(total)} input-equivalent tokens (estimate for comparing runs): orchestrator ${share}%, subagents ${100 - share}%`,
  );
  const roles: Record<string, { count: number; turns: number; usage: Usage; firstContext: number }> = {};
  for (const s of sessions) {
    for (const [name, r] of Object.entries(s.subagents.roles)) {
      const x = roles[name] ?? { count: 0, turns: 0, usage: emptyUsage(), firstContext: 0 };
      roles[name] = { count: x.count + r.count, turns: x.turns + r.turns, usage: addUsage(x.usage, r.usage), firstContext: x.firstContext + r.firstContext };
    }
  }
  if (Object.keys(roles).length) {
    lines.push("  by role (share of the total):");
    lines.push(`    orchestrator   ${Math.round(share)}%`);
    for (const [name, r] of Object.entries(roles).sort((a, b) => weighted(b[1].usage) - weighted(a[1].usage))) {
      lines.push(`    ${name.replace(/^aidw:/, "").padEnd(14)} ${Math.round((weighted(r.usage) / (total || 1)) * 100)}%  (${r.count} agent(s), ${r.turns} turns, first turn ${kilo(Math.round(r.firstContext / r.count))} tokens)`);
    }
  }
  const worst = sessions.reduce((a, b) => (b.contextMax > a.contextMax ? b : a));
  const advice: string[] = [];
  if (worst.contextMax > 200_000) advice.push(`session ${worst.id.slice(0, 8)} grew to ${kilo(worst.contextMax)} per turn, and every turn re-reads it: run \`aidw run\` (a fresh session per task) or /clear between phases`);
  const impl = roles[AGENTS.implement];
  const rev = roles[AGENTS.taskReview];
  if (impl && rev && impl.firstContext / impl.count > 2 * (rev.firstContext / rev.count)) {
    advice.push(`an implementer's first turn is ${kilo(Math.round(impl.firstContext / impl.count))} tokens against ${kilo(Math.round(rev.firstContext / rev.count))} for a reviewer: tool schemas of MCP servers and plugins ride along in every turn; use \`aidw run\` (it drops MCP servers) or disable them for the run`);
  }
  if (repeated) advice.push(`${repeated} Agent call(s) were sent twice: a plugin hook rewrites the call (for example context-mode); disabling it for aidw runs saves one turn per spawn`);
  const chatty = sessions.flatMap((s) => Object.entries(s.aidwCommands)).filter(([k]) => k === "status" || k === "next");
  const chattyCalls = chatty.reduce((n, [, v]) => n + v, 0);
  if (chattyCalls > 12) advice.push(`${chattyCalls} separate \`aidw status\`/\`aidw next\` calls: each is a turn that re-reads the whole context`);
  if (advice.length) lines.push("", "what to look at:", ...advice.map((a) => `  - ${a}`));
  return `${lines.join("\n")}\n`;
}
