/**
 * Deterministic skill selection per task (decision D-23, blueprint section 8).
 *
 * Loading all 13 vendored Addy skills costs ~35-40k tokens per agent. Each task loads only
 * what its contract (touches, verify, risk, role) shows it needs. A task may add skills with
 * an explicit `skills:` list in tasks.yaml.
 */
import type { Task } from "./tasks.js";

export interface SkillPick {
  /** vendored id, e.g. "addy/test-driven-development" */
  id: string;
  reason: string;
}

export type BriefKind = "implement" | "review";

const ADDY = (name: string) => `addy/${name}`;

const UI_TOUCH = /(^|\/)(components?|pages|views|layouts?|styles?|ui|public)(\/|$)|\.(tsx|jsx|vue|svelte|css|scss|html)\b|(^|\/)(src\/)?app\/(?!api\/)/;
const API_TOUCH = /(^|\/)(api|server|routes?|actions?|trpc|graphql|controllers?|services?|handlers?|middleware)(\/|\.|$)/;
const DATA_TOUCH = /(^|\/)(supabase|migrations?|prisma|drizzle|db|database|schema)(\/|\.|$)/;
const SECURITY_HINT = /\b(auth|login|logout|sign-?in|sign-?up|session|password|permissions?|roles?|rls|policy|policies|payments?|stripe|checkout|billing|webhooks?|middleware|admin|tokens?|secrets?)\b/i;
const BROWSER_VERIFY = /\b(playwright|cypress|e2e)\b/i;

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** True when the task's contract or title hints at security-sensitive work. */
export function isSecuritySensitive(t: Task): boolean {
  if (t.risk === "high") return true;
  const text = [t.title ?? "", ...list(t.touches), ...list(t.specs), ...list(t.scenarios)].join(" ").replace(/[/_.-]/g, " ");
  return SECURITY_HINT.test(text);
}

export function touchesUi(t: Task): boolean {
  return list(t.touches).some((g) => UI_TOUCH.test(g));
}

export function selectSkills(t: Task, kind: BriefKind, opts: { retry?: boolean } = {}): SkillPick[] {
  const picks: SkillPick[] = [];
  const add = (name: string, reason: string) => {
    const id = name.includes("/") ? name : ADDY(name);
    if (!picks.some((p) => p.id === id)) picks.push({ id, reason });
  };
  const touches = list(t.touches);
  const role = String(t.role ?? "");

  if (kind === "review") {
    add("code-review-and-quality", "every review");
    if (isSecuritySensitive(t)) add("security-and-hardening", "security-sensitive task (risk or auth/payment/permissions)");
    return picks;
  }

  add("incremental-implementation", "core: every implementation task");
  add("test-driven-development", "core: tests per scenario before code");

  const ui = touchesUi(t) || role === "frontend-engineer";
  const api = touches.some((g) => API_TOUCH.test(g)) || role === "backend-engineer";
  const data = touches.some((g) => DATA_TOUCH.test(g)) || role === "database-engineer";
  if (ui) add("frontend-ui-engineering", "touches UI files");
  if (api) add("api-and-interface-design", "touches API or server code");
  else if (data) add("api-and-interface-design", "touches the data layer (schema is an interface)");
  // No signal, no skill: a slice touching only plain logic gets the core pair, nothing "just in case".
  if (isSecuritySensitive(t)) add("security-and-hardening", "security-sensitive task (risk or auth/payment/permissions)");
  if (list(t.verify).some((v) => BROWSER_VERIFY.test(v))) add("browser-testing-with-devtools", "verify runs browser/E2E tests");
  if (opts.retry) add("debugging-and-error-recovery", "previous attempt failed");
  for (const s of list(t.skills)) add(s, "requested by the task (tasks.yaml skills:)");
  return picks;
}
