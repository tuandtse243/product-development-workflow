/**
 * Deterministic skill selection per task (decision D-23, blueprint section 8).
 *
 * Loading all 13 vendored Addy skills costs ~35-40k tokens per agent. Each task loads only
 * what its contract (touches, verify, risk, role) shows it needs. A task may add skills with
 * an explicit `skills:` list in tasks.yaml.
 *
 * A skill id is `<source>/<name>`. Vendored Skills (ADR-0005) live in `library/vendor/<source>/<name>/SKILL.md`;
 * the source `aidw` is an Authored Skill shared by several Roles, in `library/skills/<name>/SKILL.md`.
 */
import { join } from "node:path";
import type { Task } from "./tasks.js";

export interface SkillPick {
  /** vendored id, e.g. "addy/test-driven-development" */
  id: string;
  reason: string;
}

export type BriefKind = "implement" | "review";

const ADDY = (name: string) => `addy/${name}`;

/** Absolute path of a skill's SKILL.md, given the plugin's `library/vendor` directory. */
export function skillPath(vendorDir: string, id: string): string {
  const [source, ...name] = id.split("/");
  return source === "aidw" ? join(vendorDir, "..", "skills", ...name, "SKILL.md") : join(vendorDir, ...id.split("/"), "SKILL.md");
}

const UI_TOUCH = /(^|\/)(components?|pages|views|layouts?|styles?|ui|public)(\/|$)|\.(tsx|jsx|vue|svelte|css|scss|html)\b|(^|\/)(src\/)?app\/(?!api\/)/;
const API_TOUCH = /(^|\/)(api|server|routes?|actions?|trpc|graphql|controllers?|services?|handlers?|middleware)(\/|\.|$)/;
const DATA_TOUCH = /(^|\/)(supabase|migrations?|prisma|drizzle|db|database|schema)(\/|\.|$)/;
// A client's `schema.ts` is a form schema (zod, yup), not the data layer: for the frontend Role `schema` alone is no signal.
const CLIENT_DATA_TOUCH = /(^|\/)(supabase|migrations?|prisma|drizzle|db|database)(\/|\.|$)/;
const SECURITY_HINT = /\b(auth|login|logout|sign-?in|sign-?up|session|password|permissions?|roles?|rls|policy|policies|payments?|stripe|checkout|billing|webhooks?|middleware|admin|tokens?|secrets?)\b/i;
const BROWSER_VERIFY = /\b(playwright|cypress|e2e)\b/i;
const DOCKERFILE_TOUCH = /(^|\/)(Dockerfile[\w.-]*|\.dockerignore|docker)(\/|$|\*)/i;
const COMPOSE_TOUCH = /(^|\/)(docker-)?compose[\w.-]*\.ya?ml/i;
const WORKFLOW_TOUCH = /(^|\/)\.github\/(workflows|actions)(\/|$)/;
const PYTHON_PROJECT_TOUCH = /(^|\/)(pyproject\.toml|uv\.lock)$/;
const MOTION_HINT = /\b(animat\w*|transitions?|motion|easing|gestures?|drag|swipe)\b/i;
const OBSERVABILITY_HINT = /\b(logging|logs?|metrics?|tracing|traces?|telemetry|observability|monitoring|alerts?|health ?checks?)\b/i;
// sentry/secret-serialization (plan section 5, T14 S7): narrow on purpose. Either the task works on a sink that
// serializes whole objects (logs, traces, error reports), or a credential goes onto a config or client object.
// Title and scenarios say what the task is about; Touches only say where (never read a credential from Touches alone).
const SINK_WORDS = /\b(logging|loggers?|log(ged)? (to|with|the|failed|errors?)|logs (failed|errors?)|structured logs?|tracing|spans?|telemetry|opentelemetry|otel|instrumentation|error (reporting|tracking|context)|sentry|redact\w*)\b/i;
const SINK_TOUCH = /(^|\/)(logging|loggers?|telemetry|tracing|instrumentation|observability|sentry)(\/|\.|$)/i;
const CREDENTIAL_WORDS = /\b(secrets?|api ?keys?|apikeys?|credentials?|access ?keys?|private ?keys?|signing ?keys?|client ?secrets?|tokens?|passwords?)\b/i;
/** Values that live only on a config or client object: no holder needed. */
const SELF_HELD_CREDENTIAL = /\b(dsn|connection ?strings?)\b/i;
/** "the OpenAI key from the environment": a bare "key" counts only next to env or environment. */
const ENV_WORDS = /\b(env|environment)\b/i;
const HOLDER_WORDS = /\b(config|configuration)\b/i;
const CONFIG_TOUCH = /(^|\/)(config|settings)(\/|\.\w+$)/i;
const ENV_EXAMPLE_TOUCH = /(^|\/)\.env\.example$/;
const ADAPTER_TOUCH = /(^|\/)(adapters?|clients?|integrations?|providers?|gateways?)(\/|[.-])/i;

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** True when the task's contract or title hints at security-sensitive work. */
export function isSecuritySensitive(t: Task): boolean {
  if (t.risk === "high") return true;
  const text = [t.title ?? "", ...list(t.touches), ...list(t.specs), ...list(t.scenarios)].join(" ").replace(/[/_.-]/g, " ");
  return SECURITY_HINT.test(text);
}

/** True for a backend or fullstack task that stores a credential on a config or client object, or works on a sink
 * that serializes whole objects: the signal for `sentry/secret-serialization`. A task with no role is fullstack. */
export function handlesSecretSerialization(t: Task): boolean {
  const role = String(t.role ?? "");
  if (role && role !== "backend" && role !== "fullstack") return false;
  const touches = list(t.touches);
  const text = [t.title ?? "", ...list(t.scenarios)].join(" ").replace(/[/_.-]/g, " ").replace(/\blog in\b/gi, "");
  if (SINK_WORDS.test(text) || touches.some((g) => SINK_TOUCH.test(g))) return true;
  if (SELF_HELD_CREDENTIAL.test(text)) return true;
  const credential = CREDENTIAL_WORDS.test(text);
  if (credential && (HOLDER_WORDS.test(text) || touches.some((g) => CONFIG_TOUCH.test(g)))) return true;
  if ((credential || /\bkeys?\b/i.test(text)) && ENV_WORDS.test(text)) return true;
  return touches.some((g) => ENV_EXAMPLE_TOUCH.test(g)) && touches.some((g) => ADAPTER_TOUCH.test(g));
}

const SECRET_SERIALIZATION = "sentry/secret-serialization";
const SECRET_SERIALIZATION_READ =
  "read its SKILL.md and only the reference for the project's language (references/python.md or references/javascript-typescript.md); skip SPEC.md and SOURCES.md";

export function touchesApi(t: Task): boolean {
  return list(t.touches).some((g) => API_TOUCH.test(g));
}

export function touchesUi(t: Task): boolean {
  return list(t.touches).some((g) => UI_TOUCH.test(g));
}

/**
 * Skills written for another setup (a human to ask, a pull request, a cloud console). `library/vendored-skill-notes.md`
 * says what differs under aidw and lists the statements in them that are known to be wrong; a brief that loads one
 * of these points to the notes.
 */
export const SKILLS_WITH_NOTES: ReadonlySet<string> = new Set([
  "obra/verification-before-completion",
  "obra/systematic-debugging",
  "obra/receiving-code-review",
  "addy/observability-and-instrumentation",
  "supabase/supabase-postgres-best-practices",
  "docker/docker-project-foundations",
  "docker/docker-build-strategies",
  "docker/docker-compose-patterns",
  "sentry/gha-security-review",
  "sentry/django-perf-review",
  "sentry/secret-serialization",
  "fastapi/fastapi",
  "svelte/svelte-core-bestpractices",
  "vue/vue-best-practices",
  "astral/uv",
  "anthropic/frontend-design",
  "emil/animate",
]);

/**
 * `designTokens`: the approved design has tokens (`.aidw/design/tokens.yaml` parses and is not empty). A frontend task
 * then applies a design and does not make one, so `anthropic/frontend-design` (a design lead's "take aesthetic risk")
 * is left out for it.
 */
export function selectSkills(t: Task, kind: BriefKind, opts: { retry?: boolean; reviewFix?: boolean; designTokens?: boolean } = {}): SkillPick[] {
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
    if (touches.some((g) => WORKFLOW_TOUCH.test(g))) add("sentry/gha-security-review", "the task changes a GitHub Actions workflow");
    if (handlesSecretSerialization(t)) add(SECRET_SERIALIZATION, `a credential on a config or client object, or a sink that serializes whole objects: check holder and sink; ${SECRET_SERIALIZATION_READ}`);
    return picks;
  }

  add("incremental-implementation", "core: every implementation task");
  add("test-driven-development", "core: tests per scenario before code");
  add("obra/verification-before-completion", "core: run the proof before you say it works");

  const ui = touchesUi(t) || role === "frontend";
  // A frontend task calls an API, it never designs one: `actions.ts` or `src/api/client.ts` in its Touches is a client.
  const api = role !== "frontend" && (touches.some((g) => API_TOUCH.test(g)) || role === "backend");
  const data = touches.some((g) => (role === "frontend" ? CLIENT_DATA_TOUCH : DATA_TOUCH).test(g)) || role === "database";
  if (ui) add("frontend-ui-engineering", "touches UI files");
  if (ui && !(role === "frontend" && opts.designTokens)) add("anthropic/frontend-design", "touches UI files: an interface with a point of view (a frontend task with approved design tokens follows them instead, so it does not load this)");
  if (ui && MOTION_HINT.test([t.title ?? "", ...list(t.scenarios)].join(" ").replace(/[/_.-]/g, " "))) add("emil/animate", "the task is about motion");
  if (api) add("api-and-interface-design", "touches API or server code");
  if (api) add("aidw/api-design-rules", "touches API or server code: the concrete rules (errors, lists, repeated writes)");
  else if (data && role !== "frontend") add("api-and-interface-design", "touches the data layer (schema is an interface)");
  // No signal, no skill: a slice touching only plain logic gets the core pair, nothing "just in case".
  if (isSecuritySensitive(t)) add("security-and-hardening", "security-sensitive task (risk or auth/payment/permissions)");
  if (list(t.verify).some((v) => BROWSER_VERIFY.test(v))) add("browser-testing-with-devtools", "verify runs browser/E2E tests");
  if (data) add("aidw/schema-evolution", "touches the data layer: what each schema change costs on a table with rows, and the expand, migrate, contract order");
  if (data) add("supabase/supabase-postgres-best-practices", "touches the data layer: Postgres rules (read the reference a rule names only when you need it)");
  if (touches.some((g) => DOCKERFILE_TOUCH.test(g))) {
    add("docker/docker-project-foundations", "touches a Dockerfile");
    add("docker/docker-build-strategies", "touches a Dockerfile");
  }
  if (touches.some((g) => COMPOSE_TOUCH.test(g))) add("docker/docker-compose-patterns", "touches a compose file");
  if (handlesSecretSerialization(t)) add(SECRET_SERIALIZATION, `a credential on a config or client object, or a sink that serializes whole objects: keep the secret out of logs, traces and error reports; ${SECRET_SERIALIZATION_READ}`);
  if (OBSERVABILITY_HINT.test([t.title ?? "", ...list(t.scenarios)].join(" ").replace(/[/_.-]/g, " "))) add("observability-and-instrumentation", "the task is about logs, metrics or traces");
  if (touches.some((g) => PYTHON_PROJECT_TOUCH.test(g))) {
    add("astral/uv", "the task sets up or changes the Python project file");
    add("astral/ruff", "the task sets up or changes the Python project file");
  }
  // One debugging skill: the systematic one. Addy's debugging-and-error-recovery stays available through `skills:`.
  if (opts.retry) add("obra/systematic-debugging", "previous attempt failed: find the root cause before changing code again");
  if (t.origin === "quality") add("obra/systematic-debugging", "fixing a failing quality layer: find the root cause first");
  if (opts.reviewFix) add("obra/receiving-code-review", "the reviewer asked for fixes: check each point against the code before acting on it");
  for (const s of list(t.skills)) add(s, "requested by the task (tasks.yaml skills:)");
  return picks;
}
