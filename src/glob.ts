/**
 * Minimal glob matching for task `touches` (project-relative, forward slashes):
 *   **  any number of path segments      *  anything except "/"
 *   ?   one character except "/"         {a,b} alternatives
 * A pattern without a slash-free wildcard tail also matches everything below it
 * ("lib/booking" == "lib/booking/**").
 */
export function globToRegExp(glob: string): RegExp {
  let g = glob.trim().replace(/^\.\//, "");
  if (g.endsWith("/")) g += "**";
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i] as string;
    if (c === "*") {
      if (g[i + 1] === "*") {
        const slashAfter = g[i + 2] === "/";
        re += slashAfter ? "(?:.*/)?" : ".*";
        i += slashAfter ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = g.indexOf("}", i);
      if (end < 0) re += "\\{";
      else {
        re += `(?:${g
          .slice(i + 1, end)
          .split(",")
          .map((s) => s.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
          .join("|")})`;
        i = end;
      }
    } else re += c.replace(/[.+^$()|[\]\\}]/g, "\\$&");
  }
  return new RegExp(`^${re}(?:/.*)?$`);
}

export function matchesAny(globs: readonly string[], path: string): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}
