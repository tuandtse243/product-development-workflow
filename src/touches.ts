/** Glob overlap helpers shared by wave planning (parallel.ts) and the pre-approval plan check (plan.ts). */

/** Leading path segments of a glob up to the first wildcard ("app/api/**" -> ["app", "api"]). */
export function staticPrefix(glob: string): string[] {
  const segs = glob.trim().replace(/^\.\//, "").replace(/\/+$/, "").split("/").filter(Boolean);
  const out: string[] = [];
  for (const s of segs) {
    if (/[*?{[]/.test(s)) break;
    out.push(s);
  }
  return out;
}

/**
 * Conservative: two globs may match a common file unless their static prefixes differ in some segment.
 * ("app/api/**" vs "lib/**" are disjoint; "app/**" vs "app/page.tsx" overlap; "**" overlaps everything.)
 */
export function globsOverlap(a: string, b: string): boolean {
  const pa = staticPrefix(a);
  const pb = staticPrefix(b);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) if (pa[i] !== pb[i]) return false;
  return true;
}

export const touchesOverlap = (a: string[], b: string[]) => a.some((x) => b.some((y) => globsOverlap(x, y)));

