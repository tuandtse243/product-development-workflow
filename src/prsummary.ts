/**
 * The pull request summary (I8, Q5, M8): `delivery/pr-summary.md`, written by the Documentation Role at delivery and
 * laid out after html-effectiveness example 17: Why in one sentence, 1 to 3 notes, a change outline made of Views.
 * `aidw pr` puts it in the body next to the generated Evidence and refuses it when it names a file that is neither in
 * the git diff of the Change Branch nor an approved Artifact, so the prose cannot invent a file.
 *
 * A path is recognised where the summary names a file on purpose:
 *   - an inline code span or a Markdown link target outside fenced blocks that ends in a known file extension
 *     (`src/a.ts`, `src/a.ts:12-30`, `README.md`) or in `/` (a folder, `app/api/`); a branch (`aidw/reschedule`), a
 *     media type (`application/json`), a route (`/api/x`), a package (`@scope/x`), a URL, a glob
 *     or a property (`process.env`) is not
 *   - each line of a ` ```tree ` block: box-drawing characters dropped, an optional mark (`+` new, `~` changed, `-`
 *     removed), then one path from the project root, then words on what it is for (the Program Design's file tree)
 *   - in any other fenced block: the headers of a git diff (`diff --git a/x b/x`, `--- a/x`, `+++ b/x`), and the file
 *     named in a comment on its first line (`// lib/repo.ts`, `# app/x.py`)
 * A path ending in `/` is a folder: known when a known file lies under it. A name with a space counts only with a `/`
 * and a known extension and no space before the first `/`, so a command in backticks is not a path. `\` is read as `/`.
 * A path with a `..` segment is always unknown: refused, not skipped. A bare file name in prose (no `/`: `README.md`,
 * but also `Next.js`) is never refused: it cannot be told from a product name.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Change } from "./change.js";
import { packageDigests } from "./approval.js";
import { OpError } from "./diag.js";
import { git } from "./git.js";
import { readText, rel, type Paths } from "./project.js";

export const PR_SUMMARY = "pr-summary.md";

export const prSummaryFile = (change: Change) => join(change.dir, "delivery", PR_SUMMARY);

/** File extensions that make a token without a `/` a path (`README.md`), so `process.env` or `v1.2` is not one. */
const EXT =
  /\.(md|mdx|txt|json|jsonc|ya?ml|toml|ini|lock|example|[cm]?[jt]sx?|py|rb|go|rs|java|kts?|swift|c|h|cpp|cs|php|sql|prisma|dbml|graphql|gql|css|scss|sass|less|html?|vue|svelte|astro|sh|bash|zsh|ps1|xml|svg|png|jpe?g|webp|gif|csv|tf|hcl|proto)$/i;

/**
 * A token that names a file or folder, cleaned of a line suffix; null when it is something else. `strict` (prose: a
 * code span, a link): only a known extension or a trailing `/` makes it a path, so `origin/main` or `i/o` is not one.
 */
function asPath(raw: string, strict = false): string | null {
  let s = raw.trim().replace(/^["'(]+|["'),.;]+$/g, "");
  s = s.replace(/(#L\d+(-L?\d+)?|:\d+(-\d+)?)$/, "");
  if (!s || s.includes("://") || /[*?<>{}|`$]/.test(s)) return null;
  // a name with a space is a path only when it clearly is one: a `/` and a known extension, and no space before the
  // first `/` (`app/book now/page.tsx`); a command (`node scripts/build.mjs`, `psql -f db/x.sql`) is not
  if (/\s/.test(s) && !(s.includes("/") && EXT.test(s) && !/\s/.test(s.slice(0, s.indexOf("/"))))) return null;
  if (s.startsWith("/") || s.startsWith("@") || s.startsWith("-") || s.startsWith("~")) return null;
  s = s.replace(/^\.\//, "");
  if (s === "" || s === ".") return null;
  // a `../` path is kept: it is never in the diff, so it is refused rather than skipped
  if (EXT.test(s) || (s.endsWith("/") && s.length > 1)) return s;
  return !strict && s.includes("/") ? s : null;
}

/** The paths a summary names, in order of first appearance, without repeats. */
export function summaryPaths(text: string): string[] {
  return summaryRefs(text).map((r) => r.path);
}

/**
 * The paths a summary names; `loose` marks a bare file name in prose (no `/` or `\`, such as `README.md` or `Next.js`):
 * it is checked only for being known, never refused, since a product name looks the same.
 */
export function summaryRefs(text: string): { path: string; loose: boolean }[] {
  const out: { path: string; loose: boolean }[] = [];
  const add = (raw: string | undefined, strict = false) => {
    const p = raw === undefined ? null : asPath(raw, strict);
    if (!p) return;
    const loose = strict && !/[\\/]/.test(p);
    const seen = out.find((r) => r.path === p);
    if (!seen) out.push({ path: p, loose });
    else if (!loose) seen.loose = false;
  };
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let fence: { mark: string; info: string; first: boolean } | null = null;
  for (const line of lines) {
    const f = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(line);
    if (fence) {
      if (f && f[1]!.startsWith(fence.mark[0]!) && f[1]!.length >= fence.mark.length && !f[2]) {
        fence = null;
        continue;
      }
      if (fence.info === "tree") {
        const box = /^[\s│├└┬┼─]+/;
        const rest = line.replace(box, "");
        add(/^\S+/.exec(rest.replace(/^[+~-]/, "").replace(box, ""))?.[0]);
        continue;
      }
      // git diff headers first: `--- a/x` is a header, not a `--` comment
      const g = /^diff --git a\/(\S+) b\/(\S+)/.exec(line);
      const h = /^(?:---|\+\+\+) (?:[ab]\/)?(\S+)/.exec(line);
      if (g) {
        add(g[1]);
        add(g[2]);
      } else if (h) {
        if (h[1] !== "/dev/null") add(h[1]);
      } else if (fence.first && line.trim()) {
        add(/^\s*[+ -]?\s*(?:\/\/|#|--|\/\*)\s*(\S+?)(?:\s*\*\/)?\s*$/.exec(line)?.[1]);
      }
      if (line.trim()) fence.first = false;
      continue;
    }
    if (f) {
      fence = { mark: f[1]!, info: (f[2] ?? "").toLowerCase(), first: true };
      continue;
    }
    for (const m of line.matchAll(/(`+)([^`]+?)\1(?!`)/g)) add(m[2], true);
    // Markdown link targets: [text](lib/a.ts); an anchor or a URL is not a file
    for (const m of line.replace(/`[^`]*`/g, "").matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) if (!m[1]!.startsWith("#")) add(m[1]!.replace(/#.*$/, ""), true);
  }
  return out;
}

/** The files a summary may name: the git diff of the Change Branch against its base, and the approved Artifacts. */
export function knownPaths(p: Paths, change: Change, base: string, head: string): { files: Set<string>; diffFailed: string | null } {
  const files = new Set<string>();
  // --no-renames: a renamed file is listed under its old name too, so the summary may name either
  const diff = git(p.project, ["diff", "--name-only", "--no-renames", `${base}...${head}`]);
  if (diff.ok) for (const f of diff.out.split("\n").filter(Boolean)) files.add(f);
  // the approved package of the Change's own version (src/approval.ts): change files under their path now, and under
  // the path they have while active, after the archive, and inside the Change folder, since the summary may use any
  // (the archive names the folder `<date>-<id>`)
  const dir = rel(p, change.dir);
  const ids = [...new Set([change.id, change.id.replace(/^\d{4}-\d{2}-\d{2}-/, "")])];
  const homes = ids.flatMap((i) => [rel(p, join(p.changes, i)), rel(p, join(p.archive, i))]);
  for (const f of packageDigests(p, change).keys()) {
    files.add(f);
    if (f.startsWith(`${dir}/`)) {
      const inner = f.slice(dir.length + 1);
      files.add(inner);
      for (const h of homes) files.add(`${h}/${inner}`);
    }
  }
  return { files, diffFailed: diff.ok ? null : (diff.err || diff.out).split("\n")[0] || `git diff ${base}...${head} failed` };
}

/** The paths of the summary that name no known file (a folder is known when a known file lies under it). */
export function unknownPaths(paths: string[], known: Set<string>): string[] {
  const all = [...known];
  return paths.filter((raw) => {
    // a path written with Windows separators is the same file; one that climbs with `..` is never known
    const x = raw.replace(/\\/g, "/");
    if (x.split("/").includes("..")) return true;
    if (known.has(x)) return false;
    const dir = x.endsWith("/") ? x : `${x}/`;
    return !all.some((k) => k.startsWith(dir));
  });
}

export interface PrSummary {
  /** the summary as it goes into the body: its H1 dropped (the pull request has its own title) */
  text: string;
  file: string;
  /** the sections of example 17 the summary lacks (`## Why`, `## Notes`, `## Change outline`): warned, not refused */
  warnings: string[];
}

export const PR_SUMMARY_SECTIONS = ["Why", "Notes", "Change outline"] as const;

/** The required sections the summary lacks, headings inside fenced blocks not counted. */
export function missingSections(text: string): string[] {
  let fence = false;
  const heads = new Set<string>();
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    else if (!fence) {
      const m = /^##\s+(.+?)\s*#*\s*$/.exec(line);
      if (m) heads.add(m[1]!.toLowerCase());
    }
  }
  return PR_SUMMARY_SECTIONS.filter((s) => !heads.has(s.toLowerCase()));
}

/**
 * The Change's pull request summary, checked; null when the Documentation Role wrote none (the body then keeps the
 * Analysis summary). Throws with every unknown path named.
 */
export function readPrSummary(p: Paths, change: Change, base: string, head: string): PrSummary | null {
  const file = prSummaryFile(change);
  if (!existsSync(file)) return null;
  const raw = readText(file) ?? "";
  const { files, diffFailed } = knownPaths(p, change, base, head);
  const unknown = unknownPaths(summaryRefs(raw).filter((r) => !r.loose).map((r) => r.path), files);
  if (unknown.length) {
    throw new OpError(
      `${rel(p, file)} names ${unknown.length === 1 ? "a file" : "files"} absent from the git diff (${base}...${head}) and from the approved Artifacts: ${unknown.map((u) => `\`${u}\``).join(", ")}${diffFailed ? ` (the diff could not be read: ${diffFailed})` : ""}; name only files the Change Branch changed or the approved package holds, then run \`aidw pr ${change.id}\` again`,
    );
  }
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*# [^\n]*\n/, "")
    .trim();
  const warnings = missingSections(raw).map((m) => `${rel(p, file)} has no "## ${m}" section (Why in one sentence, 1 to 3 Notes, a Change outline of Views)`);
  return { text, file, warnings };
}
