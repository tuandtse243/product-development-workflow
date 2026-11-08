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

/** Tier 3 (and tier 2 until the Analysis allowlist exists): outward-facing or costly actions. */
export const ASK_COMMANDS: Rule[] = [
  { re: /\bgit\s+push\b/, why: "pushes to a remote repository" },
  { re: cmd(String.raw`(?:npx\s+)?vercel\b[^|;&]*(?:--prod\b|\bpromote\b|\bdomains?\b|\balias\b)`), why: "changes Vercel production or domains" },
  {
    re: cmd(String.raw`(?:npx\s+)?vercel(?:\s+deploy)?(?:\s+--?[\w-]+(?:=\S+)?)*\s*(?:$|[;&|])`),
    why: "creates a Vercel deployment (tier 2: needs the approved allowlist)",
  },
  { re: /\bnetlify\s+deploy\b[^|;&]*--prod\b/, why: "deploys Netlify production" },
  { re: /\b(railway\s+up|fly\s+deploy|flyctl\s+deploy)\b/, why: "deploys to a hosting provider" },
  { re: /\bsupabase\s+(db\s+push|db\s+reset\s+[^|;&]*--linked|projects\s+(create|delete)|link)\b/, why: "changes a remote Supabase project" },
  { re: /\b(npm|pnpm|yarn)\s+publish\b/, why: "publishes a package" },
  { re: /\b(terraform\s+(apply|destroy)|pulumi\s+(up|destroy)|kubectl\s+(apply|delete)|docker\s+push)\b/, why: "changes infrastructure" },
  { re: /\bgh\s+(repo\s+(create|delete)|pr\s+merge|release\s+create)\b/, why: "changes GitHub state" },
  { re: /\bstripe\b[^|;&]*--live\b|\bsk_live_/, why: "uses live payment credentials" },
  { re: /\bdrop\s+(database|schema)\b/i, why: "drops a database" },
];

/** Bash commands that write files or install/scaffold; blocked before approval. */
export const WRITE_COMMANDS: Rule[] = [
  { re: /(^|[^0-9&<>=-])>{1,2}\s*(?!&|\/dev\/null\b)[^\s&|;]/, why: "redirects output into a file" },
  { re: cmd(String.raw`tee\b`), why: "writes files with tee" },
  { re: /\|\s*tee\b/, why: "writes files with tee" },
  { re: cmd(String.raw`sed\s+(?:-[a-zA-Z]*i|--in-place)`), why: "edits files in place" },
  { re: cmd(String.raw`(?:cp|mv|touch|mkdir|rm|rmdir|ln|chmod|install|rsync|unzip|tar\s+-?[a-z]*x)\b`), why: "modifies the filesystem" },
  { re: cmd(String.raw`(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|create|init|dlx)\b|npx\s+(?:create-|degit|shadcn)`), why: "installs or scaffolds packages" },
  { re: cmd(String.raw`git\s+(?:clone|checkout\s+-b|switch\s+-c|apply|am|stash\s+pop|reset\s+--hard)\b`), why: "changes the working tree" },
];

export function firstMatch(rules: Rule[], text: string): Rule | undefined {
  return rules.find((r) => r.re.test(text));
}

/** `aidw approve` is a human decision: the agent may run it only through a permission prompt. */
export const APPROVE_COMMAND = /(^|[\s;&|(])(?:[^\s;&|]*\/)?aidw\s+approve\b/;

/** Commands that invoke the aidw CLI itself (its writes stay inside .aidw/). */
export const AIDW_COMMAND = /^\s*(?:[^\s;&|]*\/)?aidw\s/;

/** Shell syntax that chains or substitutes commands; an aidw command using it gets the full checks. */
export const SHELL_CHAINING = /[;&|`<>]|\$\(/;

/** aidw commands that record progress or change state: the orchestrator's job, never a subagent's. */
export const AIDW_STATE_COMMAND = /(^|[\s;&|(])(?:[^\s;&|]*\/)?aidw\s+(?:task|checkpoint|review|transition|approve|archive|merge|init|change|brief)\b/;
