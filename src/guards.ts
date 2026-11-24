/**
 * Evidence required before entering a state (blueprint section 11: never skip silently).
 * `aidw transition` refuses the move with the returned reason. Resuming from paused is exempt.
 */
import { auditReady } from "./audit.js";
import { loadChange } from "./change.js";
import { installGuard } from "./installcheck.js";
import { machineOf, workflowIdOf } from "./machine.js";
import { convergePassed } from "./converge.js";
import type { Paths } from "./project.js";
import { pendingIntegration } from "./parallel.js";
import { lastDeploy, parseQuality, qualityFile, qualityPassed } from "./quality.js";
import { readText } from "./project.js";
import { loadTasks } from "./run.js";

export function transitionGuard(p: Paths, id: string, target: string): string | null {
  const change = loadChange(p, id);
  // An audit is delivered when its report is assembled; it has no build, deploy or delivery package.
  if (workflowIdOf(p, change) === "audit") return target === "delivered" ? auditReady(p, id) : null;
  if (target === "executing") {
    // Packages must be installable before the build starts: an implementer cannot fix a scanner, a proxy or a sandbox.
    const text = readText(qualityFile(change));
    const q = text === null ? null : parseQuality(text, "quality.yaml").config;
    const why = q ? installGuard(p, id, q.layers.flatMap((l) => [...l.setup, ...l.run])) : null;
    if (why) return why;
  }
  if (!("deploying" in machineOf(p, change).transitions)) return null;
  if (target === "verifying") {
    const open = loadTasks(p, id).tasks.filter((t) => String(t.status ?? "pending") !== "done");
    if (open.length) return `"verifying" needs every task done; open: ${open.map((t) => `${t.id} (${String(t.status ?? "pending")})`).join(", ")}`;
    const merged = pendingIntegration(loadChange(p, id), loadTasks(p, id).tasks);
    if (merged.length) return `"verifying" needs the last wave integrated: run \`aidw integrate\` (merged: ${merged.map((t) => t.id).join(", ")})`;
  }
  if (target === "converging") {
    const q = qualityPassed(p, id);
    if (!q.ok) return `"converging" needs every quality layer passing on the current code; run \`aidw verify\` (pending: ${q.pending.join(", ")})`;
  }
  if (target === "deploying") {
    const c = convergePassed(p, id);
    if (!c.ok) return `"deploying" needs a passing converge on the current code: ${c.reason}`;
  }
  if (target === "delivered") {
    const d = lastDeploy(loadChange(p, id));
    if (!d?.ok) return `"delivered" needs a successful \`aidw deploy\`${d ? ` (last: ${d.error ?? "failed"})` : ""}`;
  }
  return null;
}
