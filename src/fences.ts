// Markdown code fences, read the same way wherever aidw looks for headings or blocks outside them.

/**
 * Feed lines in order: `step` is true for a fence line or a line inside a fence. An opening fence is three or more
 * backticks or tildes, indented at most three spaces (a backtick fence's info string has no backtick); it closes on a
 * line of the same character, at least as long, with nothing else on it.
 */
export function fenceTracker(): { step: (line: string) => boolean; open: () => boolean } {
  let fence: string | null = null;
  return {
    step(raw) {
      const line = raw.replace(/\r$/, "");
      if (fence === null) {
        const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (!f || (f[1]![0] === "`" && f[2]!.includes("`"))) return false;
        fence = f[1]!;
        return true;
      }
      const c = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (c && c[1]![0] === fence[0] && c[1]!.length >= fence.length) fence = null;
      return true;
    },
    open: () => fence !== null,
  };
}
