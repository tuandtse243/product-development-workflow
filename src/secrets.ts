/**
 * Guard: no credential enters the repository (ADR-0006). The added lines of a diff are matched against the key
 * formats of the common providers. Only formats that identify themselves are listed: a generic "password = ..."
 * rule would fail every test fixture. A line that carries `gitleaks:allow` is skipped. The secret is never printed.
 */
import { git } from "./git.js";
import { addedLines } from "./tamper.js";

const RULES: { kind: string; re: RegExp }[] = [
  { kind: "private key", re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { kind: "AWS access key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { kind: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: "OpenAI API key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}/ },
  { kind: "Stripe live key", re: /\b[sr]k_live_[A-Za-z0-9]{16,}/ },
  { kind: "Stripe webhook secret", re: /\bwhsec_[A-Za-z0-9]{24,}/ },
  { kind: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { kind: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: "npm token", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { kind: "SendGrid key", re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/ },
  { kind: "Supabase service key", re: /\bsb_secret_[A-Za-z0-9_-]{20,}/ },
  { kind: "database URL with a password", re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s:@/"']+:(?!\$|<|\{|password\b|postgres\b|secret\b|example\b|changeme\b|root\b|test\b|user\b|pass\b)[^\s@/"']{8,}@(?!(?:localhost|127\.0\.0\.1|db|postgres|mongo|redis|mysql)(?:[:/?"'\s]|$))/i },
];
const ALLOW = /gitleaks:allow/;
const BINARY = /\.(?:png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|zip|gz|lockb)$/i;

export interface SecretFinding {
  kind: string;
  file: string;
  line: number;
}

export function scanLine(text: string): string | null {
  if (ALLOW.test(text)) return null;
  return RULES.find((r) => r.re.test(text))?.kind ?? null;
}

/** Credentials in what a task added since its base commit (null outside git). */
export function secretsInChanges(dir: string, base: string | null, changed: string[] | null): SecretFinding[] | null {
  if (changed === null) return null;
  const out: SecretFinding[] = [];
  for (const file of changed) {
    if (BINARY.test(file)) continue;
    for (const { line, text } of addedLines(dir, base, file)) {
      const kind = scanLine(text);
      if (kind) out.push({ kind, file, line });
    }
  }
  return out;
}

/** Credentials in the staged diff: the last check before aidw commits. */
export function stagedSecrets(cwd: string): SecretFinding[] {
  const r = git(cwd, ["diff", "--cached", "-U0", "--no-color"]);
  if (!r.ok) return [];
  const out: SecretFinding[] = [];
  let file = "";
  let n = 0;
  for (const l of r.out.split("\n")) {
    if (l.startsWith("+++ ")) file = l.slice(4).replace(/^b\//, "");
    else if (l.startsWith("@@")) n = Number(/\+(\d+)/.exec(l)?.[1] ?? 0);
    else if (l.startsWith("+")) {
      const kind = BINARY.test(file) ? null : scanLine(l.slice(1));
      if (kind) out.push({ kind, file, line: n });
      n++;
    }
  }
  return out;
}

export const secretsProblem = (found: SecretFinding[]): string =>
  `credential in the code: ${found.slice(0, 5).map((f) => `${f.kind} at ${f.file}:${f.line}`).join(", ")}${found.length > 5 ? `, and ${found.length - 5} more` : ""}`;

export const secretsMessage = (found: SecretFinding[]): string =>
  `refusing to commit: ${secretsProblem(found)}. Read it from an environment variable and put only its name in .env.example; a key that was real must also be revoked. A line that only looks like a key (a documented example) can carry the comment \`gitleaks:allow\`.`;
