/**
 * Permission tiers (decision D-08, blueprint section 12). Initial pattern lists; they are
 * a best-effort first line of defense. The Stop-hook backstop detects what slips through.
 *
 *   tier 0/1  code, packages, tests, local services   -> allowed after approval
 *   tier 2    free cloud resources, preview deploys   -> ask (allowlist from Analysis lands in S4)
 *   tier 3    money, production, real email/payment,  -> ask, always
 *             cloud data deletion, pushing anywhere
 *   tier x    secrets outside the project, personal   -> deny, always
 *             credentials
 */

export interface Rule {
  re: RegExp;
  why: string;
}

/** Start of a shell command: line start, after ; & | ( a newline or a backtick, after sudo/xargs/exec/env or find -exec. */
const CMD = String.raw`(?:^|[;&|(\n\x60]\s*|\b(?:sudo|xargs|exec|env)\s+|\s-(?:exec|execdir|ok|okdir)\s+)`;
const cmd = (body: string, flags = "") => new RegExp(`${CMD}(?:${body})`, flags);

/** Tier x: paths that hold personal credentials. Matched against file paths and Bash commands. */
export const SECRET_PATHS: Rule[] = [
  // without case: macOS and Windows file systems take ~/.SSH for ~/.ssh
  { re: /(^|[\s"'=:/])~?\/?(?:[^\s"']*\/)?\.ssh(\/|\b)/i, why: "SSH keys" },
  { re: /(^|[\s"'=:/])~?\/?(?:[^\s"']*\/)?\.aws(\/|\b)/i, why: "AWS credentials" },
  { re: /(^|[\s"'=:/])~?\/?(?:[^\s"']*\/)?\.gnupg(\/|\b)/i, why: "GPG keys" },
  { re: /(^|[\s"'=:/])~?\/?(?:[^\s"']*\/)?\.kube\/config\b/i, why: "Kubernetes credentials" },
  { re: /(^|[\s"'=:/])~?\/?(?:[^\s"']*\/)?\.config\/gcloud(\/|\b)/i, why: "Google Cloud credentials" },
  { re: /(^|[\s"'=:/])~?\/?(?:[^\s"']*\/)?\.docker\/config\.json\b/i, why: "Docker registry credentials" },
  { re: /\bid_(rsa|ed25519|ecdsa)\b/i, why: "private keys" },
];

/** Tier x: commands that are never acceptable. */
export const FORBIDDEN_COMMANDS: Rule[] = [
  { re: /\bsecurity\s+(find|dump)-(generic|internet)-password\b|\bsecurity\s+dump-keychain\b/, why: "reads the macOS keychain" },
  { re: /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(\/|~|\$HOME)(\s|$)/i, why: "deletes the home or root directory" },
];

/** Package-runner prefixes in front of a CLI (npx vercel, pnpm dlx vercel, ...). */
const RUNNER = String.raw`(?:(?:npx|bunx|pnpm\s+(?:dlx|exec)|yarn\s+(?:dlx|exec)|npm\s+exec(?:\s+--)?)\s+(?:--?[\w-]+\s+)*)?`;

/** Tier 3: outward-facing or costly actions. Always ask. Checked before tier 2. */
export const ASK_COMMANDS: Rule[] = [
  { re: /\bgit(?:\s+(?:-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)|--?[\w.-]+(?:=\S+)?))*\s+push\b/, why: "pushes to a remote repository" }, // git -C <dir> push too
  { re: cmd(String.raw`${RUNNER}vercel\b[^|;&]*(?:--prod\b|--(?:environment|target)(?:=|\s+)production\b|\bpromote\b|\bdomains?\b|\balias\b|\bremove\b|\brm\b)`), why: "changes Vercel production, domains or deletes deployments" },
  { re: cmd(String.raw`${RUNNER}netlify\s+deploy\b[^|;&]*--prod\b`), why: "deploys Netlify production" },
  { re: /\b(railway\s+up|fly\s+deploy|flyctl\s+deploy)\b/, why: "deploys to a hosting provider" },
  { re: /\bsupabase\s+(db\s+reset\s+[^|;&]*--linked|projects\s+(create|delete)|orgs\s+create)\b/, why: "creates, deletes or resets a remote Supabase project" },
  { re: /\b(npm|pnpm|yarn)\s+publish\b/, why: "publishes a package" },
  { re: /\b(terraform\s+(apply|destroy)|pulumi\s+(up|destroy)|kubectl\s+(apply|delete)|docker\s+push)\b/, why: "changes infrastructure" },
  { re: /\bgh\s+(repo\s+(create|delete)|pr\s+(create|merge)|release\s+create)\b/, why: "changes GitHub state" },
  { re: /(^|[\s;&|(])["']?(?:[^\s;&|"']*\/)?aidw["']?\s+first-deploy\b/, why: "deploys the app to Vercel Production (public)" },
  { re: /(^|[\s;&|(])["']?(?:[^\s;&|"']*\/)?aidw["']?\s+pr\b[^|;&]*--create\b/, why: "pushes the change branch and opens a pull request" },
  // a key literal (sk_live_ + 8 or more characters), not a search pattern such as `grep "sk_live_[0-9a-z]{24}"` in a secret scan
  { re: /\bstripe\b[^|;&]*--live\b|\bsk_live_[A-Za-z0-9]{8,}/, why: "uses live payment credentials" },
  { re: /\bdrop\s+(database|schema)\b/i, why: "drops a database" },
];

/**
 * Tier 2: free cloud resources. Allowed without asking only when an open, approved change lists the
 * resource key in quality.yaml `permissions` (the Analysis allowlist); otherwise ask.
 */
export const TIER2_RESOURCES = {
  "vercel-preview": "Vercel preview deployments (creates/links a Vercel project on the free plan)",
  "netlify-preview": "Netlify draft (non-production) deploys",
  "supabase-dev": "a linked Supabase dev project: link, push migrations, deploy functions, set secrets",
} as const;
export type Tier2Resource = keyof typeof TIER2_RESOURCES;

export interface Tier2Rule extends Rule {
  resource: Tier2Resource;
}

export const TIER2_COMMANDS: Tier2Rule[] = [
  {
    re: cmd(String.raw`${RUNNER}vercel(?:\s+deploy)?(?:\s+--?[\w-]+(?:=\S+)?)*\s*(?:$|[;&|)])`),
    why: "creates a Vercel preview deployment",
    resource: "vercel-preview",
  },
  { re: cmd(String.raw`${RUNNER}netlify\s+deploy\b`), why: "creates a Netlify draft deploy", resource: "netlify-preview" },
  {
    re: cmd(String.raw`${RUNNER}supabase\s+(?:link|db\s+push|functions\s+deploy|secrets\s+set|migration\s+repair)\b`),
    why: "changes the linked Supabase dev project",
    resource: "supabase-dev",
  },
];

export const isTier2Resource = (s: string): s is Tier2Resource => Object.prototype.hasOwnProperty.call(TIER2_RESOURCES, s);

/** Bash commands that write files or install/scaffold; blocked before approval. */
export const WRITE_COMMANDS: Rule[] = [
  // any redirect form: `>`, `>>`, `1>`, `2>>`, `&>`, `&>>`, `>|` (clobber); `2>&1` and `/dev/` are not files
  { re: /(^|[^<>=-])(?:\d*|&)>{1,2}\|?\s*(?!&|\/dev\/|["']?(?:\$\{?TMPDIR\b|\/tmp\/|\/private\/tmp\/|\/var\/folders\/))[^\s&|;]/, why: "redirects output into a file" },
  { re: cmd(String.raw`dd\b[^|;&\n]*\bof=`), why: "writes files with dd" },
  { re: cmd(String.raw`tee\b`), why: "writes files with tee" },
  { re: /\|\s*tee\b/, why: "writes files with tee" },
  { re: cmd(String.raw`sed\s+(?:-[a-zA-Z]*i|--in-place)`), why: "edits files in place" },
  { re: cmd(String.raw`(?:cp|mv|touch|mkdir|rm|rmdir|ln|chmod|install|rsync|unzip|tar\s+-?[a-z]*x)\b`), why: "modifies the filesystem" },
  { re: cmd(String.raw`(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|create|init|dlx)\b|npx\s+(?:create-|degit|shadcn)`), why: "installs or scaffolds packages" },
  { re: cmd(String.raw`git\s+(?:clone|checkout\s+-b|switch\s+-c|apply|am|stash\s+pop|reset\s+--hard)\b`), why: "changes the working tree" },
  { re: cmd(String.raw`find\b[^|;&\n]*\s-delete\b`), why: "deletes files with find" },
];

/** A word in either case (macOS finds `NODE` on PATH); the flags after it keep their case. */
const anyCase = (word: string) => word.replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);

/**
 * Interpreters and shells, each with the flags that hand it code inline (as their own word: `-pe` and `-lc` combine
 * switches that take no value) and the flags that take a separate value. Loader flags (`node -r`, `--import`,
 * `ruby -I`, `perl -M`) load modules from files; they are not inline code.
 */
const INTERPRETERS: { names: string[]; suffix?: string; inline: string; valued?: string }[] = [
  { names: ["node", "nodejs", "tsx", "ts-node"], inline: String.raw`-[ep]{1,2}|--(?:eval|print)`, valued: String.raw`-C|-r|--require|--import|--loader|--experimental-loader|--conditions` },
  { names: ["bun"], inline: String.raw`-[ep]|--(?:eval|print)` },
  { names: ["deno"], inline: "eval" },
  { names: ["python", "pypy"], suffix: String.raw`[\d.]*`, inline: String.raw`-[bBdEhiIOqsSuvx]*c`, valued: "-X|-W" },
  { names: ["perl"], inline: String.raw`-[aclnpistTuUwWX0-9]*[eE]` },
  { names: ["ruby"], inline: "-[acdlnpsUvwWy]*e", valued: "-I|-r" },
  { names: ["php"], inline: "-r", valued: "-d|-c" },
  { names: ["sh", "bash", "zsh", "dash", "ksh", "fish"], inline: String.raw`-[a-zA-Z]*c|--command`, valued: "-o|-O|--rcfile|--init-file" },
  { names: ["pwsh"], inline: "-c|-Command|-EncodedCommand|-ec" },
  { names: ["osascript", "lua", "rscript"], inline: "-e" },
];

const names = (i: (typeof INTERPRETERS)[number]) => `(?:${i.names.map(anyCase).join("|")})${i.suffix ?? ""}`;
const ANY_INTERPRETER = String.raw`${RUNNER}(?:[^\s;&|"'\x60]*\/)?(?:${INTERPRETERS.map(names).join("|")})(?=\s|$|[;&|)<])`;

/**
 * Start of a command for the inline-code rules: also after `{`, `then`/`do`/`else`, behind environment assignments and
 * `sudo`, `env`, `time`, `command`, `nice`, `nohup`, `timeout <n>`.
 */
const START = String.raw`(?:^|[;&|(\n\x60{]\s*|\b(?:then|do|else)\s+)(?:(?:sudo|xargs|exec|env|time|command|builtin|nohup|nice)(?:\s+-\S+(?:\s+\d+)?)*\s+|timeout(?:\s+-\S+)*\s+\S+\s+|[A-Za-z_]\w*=\S*\s+)*`;

/**
 * Hides what quoted strings say, so text in an argument (a commit message, `grep -E "(bash|sh) -c"`) is never read as
 * a command: each character becomes `_`, quotes stay. `$(...)` and backticks in double quotes still run, so they stay;
 * so does a quoted redirect target (`> "$TMPDIR/x"`), which the redirect rule reads. A quoted plain word (`"node"`,
 * `'-e'`) is unquoted first: the shell runs it the same.
 */
export function maskQuoted(command: string): string {
  const c = command.replace(/(["'])([\w./+@=-]+)\1/g, "$2");
  let out = "";
  for (let i = 0; i < c.length; i++) {
    const ch = c[i] as string;
    if (ch === "\\" && i + 1 < c.length) {
      out += ch + (c[++i] as string);
      continue;
    }
    if (ch !== "'" && ch !== '"') {
      out += ch;
      continue;
    }
    const end = ch === "'" ? c.indexOf("'", i + 1) : closingDoubleQuote(c, i + 1);
    const stop = end < 0 ? c.length : end;
    const body = c.slice(i + 1, stop);
    const target = /(?:^|[^<>])>{1,2}\s*$/.test(out);
    out += ch + (target ? body : ch === '"' ? maskDouble(body) : body.replace(/[^]/g, "_")) + (end < 0 ? "" : ch);
    i = stop;
  }
  return out;
}

function closingDoubleQuote(c: string, from: number): number {
  for (let i = from; i < c.length; i++) {
    if (c[i] === "\\") i++;
    else if (c[i] === '"') return i;
  }
  return -1;
}

/** A double-quoted body with everything masked but its `$(...)` and backtick substitutions. */
function maskDouble(body: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    if (body.startsWith("$(", i)) {
      let depth = 0;
      let j = i;
      for (; j < body.length; j++) {
        if (body[j] === "(") depth++;
        else if (body[j] === ")" && --depth === 0) break;
      }
      out += body.slice(i, j + 1);
      i = j;
    } else if (body[i] === "`") {
      const j = body.indexOf("`", i + 1);
      const k = j < 0 ? body.length - 1 : j;
      out += body.slice(i, k + 1);
      i = k;
    } else out += "_";
  }
  return out;
}

/**
 * Code a command hands an interpreter inline, on stdin or from a file under `.aidw/` (outside a task's worktree):
 * whatever it does, the gate cannot tell a write from a read in it (`node -e "require('fs').writeFileSync(...)"`). A Role
 * that may not write by Bash (read-only, artifacts) may not run it either; the project's scripts and test runners still
 * run (`node script.js`, `node --import tsx --test`). Matched against `maskQuoted(command)`.
 */
export const INLINE_CODE: Rule[] = [
  ...INTERPRETERS.map((i) => ({
    re: new RegExp(
      String.raw`${START}${RUNNER}(?:[^\s;&|"'\x60]*\/)?${names(i)}(?:\s+(?:(?:${i.valued ?? "(?!)"})\s+\S+|[-+]\S*))*?\s+(?:${i.inline}|-)(?=\s|=|$|[;&|)])`,
    ),
    why: "runs inline code",
  })),
  { re: new RegExp(String.raw`${START}${ANY_INTERPRETER}(?:\s+-\S*)*\s*<`), why: "runs code from stdin" },
  { re: new RegExp(String.raw`\|\s*${ANY_INTERPRETER}(?:\s+-\S*)*\s*(?:$|[;&|)\n])`), why: "runs code from stdin" },
  {
    re: new RegExp(String.raw`${START}(?:${ANY_INTERPRETER}(?:\s+-\S*)*|source|\.)\s+[^\s;&|]*\.aidw\/(?!run\/worktrees\/[^\s/]+\/[^\s/]+\/(?!\.aidw\/))`, "i"),
    why: "runs a script from .aidw/",
  },
  { re: new RegExp(String.raw`${START}eval\s`), why: "runs a string as a command" },
];

/**
 * A write target of an implementer that the Write tool denies it too: `.aidw/` except its task worktree (but that
 * worktree's own `.aidw/`), screenshots and its report note; a verdict under `run/` or `../`; a plan review record.
 */
export const IMPLEMENTER_PROTECTED =
  /(?:^|\/)\.aidw(?:$|\/(?!run\/(?:worktrees\/[^/]+\/[^/]+\/(?!\.aidw(?:\/|$))|shots\/|report-[\w.-]+\.md$)))|(?:^|\/)(?:run|\.\.)\/(?:(?:layer-)?review-[^/]*\.md|audit-[^/]*\.md)$|(?:^|\/)plan-review\.yaml$/i;

const WORD_SKIP = new Set(["sudo", "env", "time", "command", "builtin", "nohup", "nice", "exec", "xargs"]);

/**
 * The files a command writes, as far as its words say: redirect targets, `tee` arguments, the last argument of
 * `cp`/`mv`/`ln`/`install`/`rsync` (or its `-t` directory), every argument of `rm`/`touch`/`mkdir`/`chmod`/`sed -i`...,
 * the roots of `find -delete`, `dd of=`; for inline code, every path-like word in it. Best effort, like every pattern here.
 */
export function writeTargets(command: string): string[] {
  const out: string[] = [];
  if (firstMatch(INLINE_CODE, maskQuoted(command))) out.push(...(command.match(/[^\s"'()\x60,;=<>|&]+/g) ?? []));
  for (const seg of shellSegments(command)) {
    const words: string[] = [];
    for (let i = 0; i < seg.length; i++) {
      const w = seg[i] as string;
      if (w === ">" || w === ">>") {
        if (seg[i + 1] !== undefined) out.push(seg[++i] as string);
      } else if (w === "<") i++;
      else words.push(w);
    }
    let k = 0;
    while (k < words.length) {
      const w = words[k] as string;
      if (/^[A-Za-z_]\w*=/.test(w)) k++;
      else if (WORD_SKIP.has(w)) {
        k++;
        while (k < words.length && (words[k] as string).startsWith("-")) k++;
      } else if (w === "timeout") k += 2;
      else break;
    }
    const name = (words[k] ?? "").split("/").pop()?.toLowerCase() ?? "";
    const args = words.slice(k + 1);
    const plain = args.filter((a) => !a.startsWith("-"));
    const t = args.findIndex((a) => a === "-t" || a === "--target-directory");
    if (["cp", "mv", "ln", "install", "rsync"].includes(name)) {
      if (t >= 0 && args[t + 1]) out.push(args[t + 1] as string);
      else if (plain.length) out.push(plain[plain.length - 1] as string);
    } else if (["tee", "rm", "rmdir", "touch", "mkdir", "chmod", "chown", "truncate", "unlink"].includes(name)) out.push(...plain);
    else if (name === "sed" && args.some((a) => /^(?:-[a-zA-Z]*i|--in-place)/.test(a))) out.push(...plain);
    else if (name === "find" && args.includes("-delete")) out.push(...args.slice(0, Math.max(0, args.findIndex((a) => a.startsWith("-")))));
    else if (name === "dd") out.push(...args.filter((a) => a.startsWith("of=")).map((a) => a.slice(3)));
    else if (name === "tar" || name === "unzip") out.push(...args.filter((_, j) => args[j - 1] === "-C" || args[j - 1] === "-d"));
  }
  return out;
}

/** Splits a command into simple commands (on unquoted `;`, `&`, `|`, newlines, parentheses, backticks) of unquoted words; `>`, `>>` and `<` are words of their own. */
function shellSegments(command: string): string[][] {
  const segs: string[][] = [];
  let words: string[] = [];
  let cur = "";
  let has = false;
  const flush = () => {
    if (has) words.push(cur);
    cur = "";
    has = false;
  };
  const end = () => {
    flush();
    if (words.length) segs.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i] as string;
    if (c === "\\" && i + 1 < command.length) {
      cur += command[++i];
      has = true;
    } else if (c === "'" || c === '"') {
      const close = c === "'" ? command.indexOf("'", i + 1) : closingDoubleQuote(command, i + 1);
      const stop = close < 0 ? command.length : close;
      cur += command.slice(i + 1, stop);
      has = true;
      i = stop;
    } else if (c === ">" || c === "<") {
      if (/^\d+$/.test(cur) || cur === "&") {
        cur = "";
        has = false;
      }
      flush();
      const two = c === ">" && command[i + 1] === ">";
      if (two) i++;
      if (c === ">" && command[i + 1] === "|") i++; // `>|` (clobber) is a redirect, not a pipe
      if (c === ">" && command[i + 1] === "&") {
        i++; // >&2: a descriptor, not a file
        while (/\d|-/.test(command[i + 1] ?? "")) i++;
        continue;
      }
      words.push(two ? ">>" : c);
    } else if (c === "&" && command[i + 1] === ">") {
      flush();
      cur = "&";
      has = false;
    } else if (/[;&|()\n\x60]/.test(c)) end();
    else if (c === " " || c === "\t") flush();
    else {
      cur += c;
      has = true;
    }
  }
  end();
  return segs;
}

/**
 * What a command the gate word-splits to allow must not hold: whitespace other than space and tab (JS `\s` takes NBSP,
 * \v, U+3000... for separators, the shell does not) and control or format characters (U+200B, U+FEFF, bidi marks).
 */
export const ODD_CHARACTER = /(?![ \t])[\s\p{Cc}\p{Cf}]/u;

/**
 * Hides `<` and `>` inside quoted strings so an argument like `'data:text/html,<p>ok</p>'` or `"a > b"` is not read
 * as a redirect. Redirect targets stay visible: in `> "$TMPDIR/x"` the `>` itself is outside the quotes.
 */
export function maskQuotedAngles(command: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i] as string;
    if (quote) {
      if (c === "\\" && quote === '"' && i + 1 < command.length) {
        out += c + (command[++i] as string);
        continue;
      }
      if (c === quote) quote = null;
      out += c === "<" || c === ">" ? "_" : c;
    } else {
      if (c === "'" || c === '"') quote = c;
      out += c;
    }
  }
  return out;
}

export function firstMatch<R extends Rule>(rules: R[], text: string): R | undefined {
  return rules.find((r) => r.re.test(text));
}

/** `aidw approve` is a human decision: the agent may run it only through a permission prompt. */
export const APPROVE_COMMAND = /(^|[\s;&|(])["']?(?:[^\s;&|"']*\/)?aidw["']?\s+approve\b/;

/**
 * `aidw cap <id> --raise <runs>`: raising the cap on Agent runs after the gate is the user's decision, like approving; it
 * is not a grant made ahead of time, so the gate asks every time (and a headless run cannot answer).
 */
export const CAP_COMMAND = /(^|[\s;&|(])["']?(?:[^\s;&|"']*\/)?aidw["']?\s+cap\b/;

/** `aidw archive`: it can push the archive commit under the push grant (T11), so no Agent runs it unasked. */
export const ARCHIVE_COMMAND = /(^|[\s;&|(])["']?(?:[^\s;&|"']*\/)?aidw["']?\s+archive\b/;

/**
 * `aidw run`: the headless auto-resume runner (S9); it spawns `claude -p`, so it never runs inside a session.
 * `aidw run --status` and `--stop` only read or stop the runner, so they are not matched.
 */
export const RUNNER_COMMAND = /(^|[\s;&|(])["']?(?:[^\s;&|"']*\/)?aidw["']?\s+run\b(?![^;&|]*\s--(?:status|stop)\b)/;

/** Commands that invoke the aidw CLI itself (its writes stay inside .aidw/), by name or quoted path. */
export const AIDW_COMMAND = /^\s*["']?(?:[^\s;&|"']*\/)?aidw["']?\s/;

/** Shell syntax that chains or substitutes commands; an aidw command using it gets the full checks. */
export const SHELL_CHAINING = /[;&|`<>\n\r]|\$\(/;

/** aidw commands that record progress or change state: the orchestrator's job, never a subagent's. */
export const AIDW_STATE_COMMAND =
  /(^|[\s;&|(])["']?(?:[^\s;&|"']*\/)?aidw["']?\s+(?:task|checkpoint|review|layer-review|verify|integrate|resolve|converge|deploy|first-deploy|deliver|transition|approve|archive|merge|init|change|brief|plan-review|consult|deviation|not-built|pr|cap|stages(?=[^;&|]*--done))\b/;
