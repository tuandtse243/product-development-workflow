---
name: security-review
description: How to review a whole Change for security - trace each entry point, report only what can be exploited, and filter false positives.
---

# Security review of a Change

The aim is a short list of real, exploitable problems. A long list of maybes teaches everyone to ignore the layer.

## 1. Map what the Change exposes

From the diff, list every new or changed entry point: routes, server actions, RPC methods, webhooks, queue
consumers, scheduled jobs, CLI commands, database policies, file uploads. For each write down who may call it and
what it can read or change. Everything below is done per entry point.

## 2. Trace each entry point from input to effect

Follow the data, do not pattern-match on keywords.

- **Who is calling.** Is the caller authenticated where the handler runs, not only in the UI or a layout? A check
  in the client, or in middleware that a route can bypass, does not count.
- **Are they allowed to touch this record.** Being logged in is not being the owner. Every lookup by an id from
  the request needs the owner, tenant or role in the query or a policy that enforces it. Check list endpoints and
  nested ids (`/teams/:teamId/invoices/:id`: does the invoice belong to that team?).
- **What the input can become.** Trace each request value to where it is used: a query (parameterized?), a file
  path, a shell command, a URL the server fetches, HTML, a redirect target, a template, a deserializer.
- **What leaves.** Response bodies, logs and error messages: fields the caller should not see (hashes, tokens,
  other users' data, internal ids), stack traces, a secret in a client bundle (`NEXT_PUBLIC_`, `VITE_`).
- **State changes.** Can the action be replayed, raced or done out of order (pay twice, redeem twice, skip a step)?
  Is there a limit on an expensive or abusable action (login, password reset, sending email)?

## 3. Dependencies and secrets

aidw's checkpoint already looked up each added package and scanned added lines for known key formats. You cover
what that cannot: a package that is real but does far more than the task needs, an install script, a secret that
has no recognisable format (a password in a seed file, a token in a test fixture that looks live), a secret read on
the server but passed to the client.

## 4. Report only what survives these questions

Before a finding goes in the verdict, answer each:

1. **Can I name the attacker and the request?** "A logged-in user sends `GET /api/invoices/42`" is a finding.
   "Input might not be validated" is not.
2. **Did I read the code on the path, or assume it?** If a framework, an ORM or a policy already prevents it
   (parameterized queries, auto-escaping templates, row-level security that is actually enabled), it is not a finding.
3. **Is the value attacker-controlled?** A constant, a server-side config value or an id taken from the session is not.
4. **Does it cross a trust boundary?** Code only an admin or the developer can reach is hardening, not a hole.
5. **Is it in this Change?** An old weakness the Change does not touch or worsen goes under Non-blocking.

Not findings, unless the Change makes them exploitable: missing rate limits on ordinary reads, denial of service by
large input in general, missing security headers, theoretical timing attacks, outdated-but-unaffected packages,
anything in test code, and a secret in a file that is git-ignored.

## 5. Severity decides the verdict

`fix`: a way to read or change another user's data, to act without authorization, to run code or queries of the
attacker's choice, to obtain a credential, or a destructive migration with no way back. Everything else is
Non-blocking, written so the handoff can carry it.

Each blocking line: entry point or `file:line`, the request that exploits it, and the fix that closes it.

## Sources

Ideas, not wording: the trace-then-filter method and the false-positive rules of Anthropic's
`claude-code-security-review`; the confidence rule ("report what you verified in the code") of getsentry/skills
`security-review`; the entry-point checklist follows the OWASP ASVS 5.0 chapters on authorization and
authentication. Addy Osmani's `security-and-hardening` stays the vendored checklist this skill is read with.
