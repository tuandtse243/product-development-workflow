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

/** Start of a shell command: line start, after ; & | ( or after sudo/xargs/exec. */
const CMD = String.raw`(?:^|[;&|(]\s*|\b(?:sudo|xargs|exec|env)\s+)`;
const cmd = (body: string, flags = "") => new RegExp(`${CMD}(?:${body})`, flags);

/** Tier x: paths that hold personal credentials. Matched against file paths and Bash commands. */
export const SECRET_PATHS: Rule[] = [
  { re: /(^|[\s"'=:/])~?\/?(?:[^\s"']*\/)?\.ssh(\/|\b)/, why: "SSH keys" },
  { re: /(^|[\s"'=:/])~?\/?(?:[^\s"']*\/)?\.aws(\/|\b)/, why: "AWS credentials" },
  { re: /(^|[\s"'=:/])~?\/?(?:[^\s"']*\/)?\.gnupg(\/|\b)/, why: "GPG keys" },
  { re: /(^|[\s"'=:/])~?\/?(?:[^\s"']*\/)?\.kube\/config\b/, why: "Kubernetes credentials" },
  { re: /(^|[\s"'=:/])~?\/?(?:[^\s"']*\/)?\.config\/gcloud(\/|\b)/, why: "Google Cloud credentials" },
  { re: /(^|[\s"'=:/])~?\/?(?:[^\s"']*\/)?\.docker\/config\.json\b/, why: "Docker registry credentials" },
  { re: /\bid_(rsa|ed25519|ecdsa)\b/, why: "private keys" },
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
  { re: /\bgit\s+push\b/, why: "pushes to a remote repository" },
  { re: cmd(String.raw`${RUNNER}vercel\b[^|;&]*(?:--prod\b|--(?:environment|target)(?:=|\s+)production\b|\bpromote\b|\bdomains?\b|\balias\b|\bremove\b|\brm\b)`), why: "changes Vercel production, domains or deletes deployments" },
  { re: cmd(String.raw`${RUNNER}netlify\s+deploy\b[^|;&]*--prod\b`), why: "deploys Netlify production" },
  { re: /\b(railway\s+up|fly\s+deploy|flyctl\s+deploy)\b/, why: "deploys to a hosting provider" },
  { re: /\bsupabase\s+(db\s+reset\s+[^|;&]*--linked|projects\s+(create|delete)|orgs\s+create)\b/, why: "creates, deletes or resets a remote Supabase project" },
  { re: /\b(npm|pnpm|yarn)\s+publish\b/, why: "publishes a package" },
  { re: /\b(terraform\s+(apply|destroy)|pulumi\s+(up|destroy)|kubectl\s+(apply|delete)|docker\s+push)\b/, why: "changes infrastructure" },
  { re: /\bgh\s+(repo\s+(create|delete)|pr\s+merge|release\s+create)\b/, why: "changes GitHub state" },
  { re: /\bstripe\b[^|;&]*--live\b|\bsk_live_/, why: "uses live payment credentials" },
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
  { re: /(^|[^0-9&<>=-])>{1,2}\s*(?!&|\/dev\/|["']?(?:\$\{?TMPDIR\b|\/tmp\/|\/private\/tmp\/|\/var\/folders\/))[^\s&|;]/, why: "redirects output into a file" },
  { re: cmd(String.raw`tee\b`), why: "writes files with tee" },
  { re: /\|\s*tee\b/, why: "writes files with tee" },
  { re: cmd(String.raw`sed\s+(?:-[a-zA-Z]*i|--in-place)`), why: "edits files in place" },
  { re: cmd(String.raw`(?:cp|mv|touch|mkdir|rm|rmdir|ln|chmod|install|rsync|unzip|tar\s+-?[a-z]*x)\b`), why: "modifies the filesystem" },
  { re: cmd(String.raw`(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|create|init|dlx)\b|npx\s+(?:create-|degit|shadcn)`), why: "installs or scaffolds packages" },
  { re: cmd(String.raw`git\s+(?:clone|checkout\s+-b|switch\s+-c|apply|am|stash\s+pop|reset\s+--hard)\b`), why: "changes the working tree" },
];

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

/** Commands that invoke the aidw CLI itself (its writes stay inside .aidw/), by name or quoted path. */
export const AIDW_COMMAND = /^\s*["']?(?:[^\s;&|"']*\/)?aidw["']?\s/;

/** Shell syntax that chains or substitutes commands; an aidw command using it gets the full checks. */
export const SHELL_CHAINING = /[;&|`<>]|\$\(/;

/** aidw commands that record progress or change state: the orchestrator's job, never a subagent's. */
export const AIDW_STATE_COMMAND =
  /(^|[\s;&|(])["']?(?:[^\s;&|"']*\/)?aidw["']?\s+(?:task|checkpoint|review|layer-review|verify|converge|deploy|deliver|transition|approve|archive|merge|init|change|brief)\b/;
