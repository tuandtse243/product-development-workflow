/**
 * Review layers (slice S7, decision D-28): the brief for an independent layer reviewer.
 *
 * A layer with `review: ui | security` in quality.yaml is judged by a fresh read-only subagent
 * (`aidw:ui-ux-designer`, `aidw:security`) after its commands pass. `aidw verify` writes the
 * brief below and stops; the orchestrator spawns the agent with the brief path and records the
 * verdict with `aidw layer-review <layer> pass|fix`. The brief carries everything the reviewer
 * needs as pointers and artifacts, never chat history.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decisionsToHonor } from "./analyze.js";
import { loadChange } from "./change.js";
import { loadTokens, tokensFile, tokensTable } from "./design.js";
import { matchesAny } from "./glob.js";
import { readText, rel, walkFiles, type Paths } from "./project.js";
import type { Layer, ReviewKind } from "./quality.js";
import { loadTasks, type VerifyRun } from "./run.js";
import { touchesUi } from "./skills.js";
import type { Task } from "./tasks.js";

const SKILLS: Record<ReviewKind, { id: string; reason: string }[]> = {
  ui: [
    { id: "addy/frontend-ui-engineering", reason: "UI quality bar: hierarchy, states, responsive, consistency" },
    { id: "addy/browser-testing-with-devtools", reason: "how to inspect the running app when a screenshot is not enough" },
  ],
  security: [
    { id: "addy/security-and-hardening", reason: "OWASP checklist, authz, secrets, dependencies" },
    { id: "addy/code-review-and-quality", reason: "how to read a diff for defects" },
  ],
};

const MAX_ARTIFACTS = 60;
const MAX_SHOTS = 24;
const IMAGE = /\.(png|jpe?g|webp)$/i;

/** Files matching a project-relative glob, walked from the glob's static prefix (test-results/shots/**). */
function resolveGlob(project: string, glob: string): string[] {
  const segs = glob.split("/");
  const firstWild = segs.findIndex((s) => /[*?{]/.test(s));
  const prefix = firstWild < 0 ? segs.slice(0, -1) : segs.slice(0, firstWild);
  const dir = join(project, ...prefix);
  return walkFiles(dir)
    .map((f) => rel({ project } as Paths, f))
    .filter((f) => matchesAny([glob], f));
}

export function layerArtifacts(p: Paths, layer: Layer): string[] {
  const out = new Set<string>();
  for (const g of layer.artifacts) for (const f of resolveGlob(p.project, g)) out.add(f);
  return [...out].sort().slice(0, MAX_ARTIFACTS);
}

/** Screenshots the implementers saved per task (reviewed per task; useful as a second source for the UI layer). */
function taskShots(p: Paths, id: string): string[] {
  return walkFiles(join(p.run, "shots", id))
    .filter((f) => IMAGE.test(f))
    .map((f) => rel(p, f))
    .sort()
    .slice(-MAX_SHOTS);
}

/** The commit the change started from: the earliest task base, so the reviewer sees the whole change's diff. */
function changeBase(tasks: Task[]): string | null {
  const bases = tasks.filter((t) => typeof t.base === "string" && typeof t.started_at === "string").sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
  return bases.length ? String(bases[0]?.base) : null;
}

function pointer(p: Paths, file: string, what: string): string | null {
  return existsSync(file) ? `- \`${rel(p, file)}\`: ${what}` : null;
}

export interface LayerBrief {
  layer: string;
  kind: ReviewKind;
  path: string;
  text: string;
  artifacts: string[];
}

export function buildLayerBrief(p: Paths, id: string, layer: Layer, runs: VerifyRun[], vendorDir?: string): LayerBrief {
  const kind = layer.review as ReviewKind;
  const change = loadChange(p, id);
  const tasks = loadTasks(p, id).tasks;
  const artifacts = layerArtifacts(p, layer);
  // Round 2 onwards: the reviewer already judged the artifacts that did not change since the previous brief, and each
  // image costs tokens in every later turn. List only what a fix touched (trial-3A: four UI rounds, 61% of their cost
  // was images). Per-task screenshots were reviewed per task: they are only a fallback when the layer has none.
  const prevBrief = join(p.run, "briefs", id, `${layer.name}.layer-review.md`);
  const prevAt = existsSync(prevBrief) ? statSync(prevBrief).mtimeMs : 0;
  const changedArtifacts = prevAt ? artifacts.filter((f) => statSync(join(p.project, f)).mtimeMs > prevAt) : artifacts;
  const toOpen = changedArtifacts.length ? changedArtifacts : artifacts;
  const skipped = artifacts.length - toOpen.length;
  const shots = kind === "ui" && !artifacts.length ? taskShots(p, id) : [];
  const decisions = decisionsToHonor(readText(join(change.dir, "analysis.md")) ?? "");
  const tokenInfo = kind === "ui" ? loadTokens(p) : null;
  const tokens = tokenInfo && tokenInfo.diags.errors.length === 0 ? tokenInfo.tokens : [];
  const base = changeBase(tasks);
  const uiTasks = tasks.filter((t) => touchesUi(t) && String(t.status) === "done");
  const h = (title: string, body: string[]) => (body.length ? [`## ${title}`, "", ...body, ""] : []);
  const skills = SKILLS[kind].map((s) => `- \`${vendorDir ? join(vendorDir, ...s.id.split("/"), "SKILL.md") : `aidw vendor-path ${s.id}`}\`: ${s.reason}`);
  const outputs = runs.flatMap((r) => [`\`${r.command}\` (exit ${r.exit ?? "?"}, ${Math.round(r.ms / 1000)}s):`, "", "```", r.tail.split("\n").slice(-40).join("\n"), "```", ""]);

  const pointers = [
    pointer(p, p.constitution, "engineering principles every agent follows"),
    pointer(p, join(p.architecture, "overview.md"), "architecture, folder structure, integrations"),
    pointer(p, join(p.requirements, `${id}.md`), "user stories and implementation/testing decisions"),
    ...(kind === "ui" ? [pointer(p, p.design, "design direction and assets (direction.md first)")] : []),
    pointer(p, join(change.dir, "analysis.md"), "the approved Analysis (scope, decisions, quality profile)"),
  ].filter((x): x is string => x !== null);

  const header = [
    `# Layer review brief: ${layer.name} (${kind} review) - ${String(change.data.title ?? id)}`,
    "",
    `Change \`${id}\`. You are an independent **${kind} reviewer** in a fresh context. You did not write this code.`,
    "You may read files and run read-only commands; you cannot edit anything (the aidw gate denies it).",
    "Judge the whole change as delivered, not one task: every task passed its own review, and this layer exists",
    "because per-task reviews miss what only the assembled product shows.",
    "",
  ];

  const scope = [
    base
      ? `- Code: \`git diff ${base}\` plus untracked files (\`git status --porcelain\`); \`git diff --name-only ${base}\` lists the files.`
      : "- Code: the whole project (no base commit was recorded).",
    ...(artifacts.length
      ? [
          `- Artifacts of this layer (open **every** one listed with Read):`,
          ...toOpen.map((f) => `  - \`${join(p.project, f)}\``),
          ...(skipped ? [`- ${skipped} other artifact(s) did not change since your previous round and already passed it: open one only if a fix could affect it.`] : []),
        ]
      : layer.artifacts.length
        ? [`- No file matched the layer's artifact globs (${layer.artifacts.map((g) => `\`${g}\``).join(", ")}): say so in your verdict; it is a blocking problem for a UI layer.`]
        : []),
    ...(shots.length ? [`- Per-task screenshots (already reviewed per task; use them to spot inconsistency between screens):`, ...shots.map((f) => `  - \`${join(p.project, f)}\``)] : []),
    ...(uiTasks.length ? [`- UI tasks in this change: ${uiTasks.map((t) => `${t.id} (${String(t.title ?? "")})`).join(", ")}.`] : []),
  ];

  const checklist =
    kind === "ui"
      ? [
          "1. **Design compliance.** Each token is used where its **Use** says; colors, type scale, spacing and radius come from the tokens; the layout and tone match the design direction. A visible mismatch is blocking.",
          "2. **Responsive.** At mobile width (320-390px): no horizontal overflow, nothing clipped or overlapping, touch targets at least 44px, text readable without zoom. Tablet and desktop use the width the way the design says (no stretched phone layout unless intended).",
          "3. **States.** Empty, loading, error, long text, many items, and the dark theme when tokens have dark values: each is designed, not accidental. Theme switching must not flash the wrong theme on load.",
          "4. **Consistency.** The same component looks the same on every screen: alignment, icon sizes, button heights, cell sizes in grids, spacing rhythm.",
          "5. **Hierarchy and usability.** The primary action is obvious; labels are in the product's language and consistent; focus is visible; nothing passes tests yet looks wrong to a user.",
          "6. If the artifacts miss a screen, state or viewport that matters, run the layer's command yourself (below) or inspect the app with Playwright over CDP; do not guess.",
        ]
      : [
          "1. **Authorization.** Every server path (route handlers, server actions, middleware, RPC) checks who may call it and what they may reach; no IDOR through ids in the URL or body.",
          "2. **Input and output.** Validation at every trust boundary (schemas, not ad-hoc checks); no injection (raw SQL, shell, path); no XSS (`dangerouslySetInnerHTML`, unescaped HTML, unsafe URLs).",
          "3. **Secrets.** Nothing secret reaches the client bundle (only intended `NEXT_PUBLIC_`/`VITE_` values); service keys never in client code; `.env*` ignored by git; `.env.example` has names only; the secret scan below is clean.",
          "4. **Data.** Row-level ownership (RLS or equivalent) for multi-user data; least-privilege keys; no sensitive data in logs, errors or analytics.",
          "5. **Sessions and auth.** Cookies httpOnly/secure/sameSite; CSRF protection on state-changing requests; rate limits on auth endpoints; password and token handling per the stack's library, not hand-rolled.",
          "6. **Dependencies and config.** The audit output below: high/critical findings are blocking unless the Analysis accepted them; no debug endpoints or verbose errors in production; security headers where the stack allows.",
          "Blocking means exploitable or exposing data. Hardening wishes are non-blocking.",
        ];

  const body = [
    ...h("What to review", scope),
    ...h("Checklist", checklist),
    "## Verdict",
    "",
    "Your verdict starts with exactly one line: `VERDICT: pass` or `VERDICT: fix`.",
    "For `fix`, follow with numbered blocking issues: where (file or screen and viewport), the problem, the expected fix.",
    "Only blocking issues justify `fix`; put everything else under `Non-blocking:`. Be concrete: a fix task gets your notes verbatim,",
    "and the non-blocking remarks go into the delivery's quality report and the handoff's Known issues.",
    `**Write the whole verdict to \`${join(p.run, `layer-review-${layer.name}.md`)}\` with the Write tool** (the only file you may write), then reply with just its first line, \`VERDICT: pass\` or \`VERDICT: fix\`. The orchestrator reads the file; keeping your reply short saves its context.`,
    "",
    ...h("Decisions to honor (approved; binding)", decisions.map((x) => `- ${x}`)),
    ...h(
      "Design tokens (approved; binding for UI)",
      tokens.length ? [...tokensTable(tokens), "", `Source: \`${rel(p, tokensFile(p))}\`. Each token's **Use** says where it must appear.`] : [],
    ),
    ...h("Layer commands and their output (already run, all passed)", outputs),
    ...h("Read first (context pointers; read only what you need)", pointers),
    ...h("Skills (read each SKILL.md and apply it)", skills),
  ];

  const text = [...header, ...body].join("\n").replace(/\n{3,}/g, "\n\n");
  const dir = join(p.run, "briefs", id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${layer.name}.layer-review.md`);
  writeFileSync(path, text);
  return { layer: layer.name, kind, path, text, artifacts };
}
