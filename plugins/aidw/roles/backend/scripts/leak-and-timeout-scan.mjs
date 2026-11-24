#!/usr/bin/env node
// leak-and-timeout-scan: outbound calls with no timeout (rule B12) and log calls that carry secrets or whole objects
// (rule B14). A backend Role tool: heuristic, advisory, false positives by nature. Node built-ins only.
const HELP = `
Usage: node leak-and-timeout-scan.mjs [dir] [--base <ref>] [--include-tests] [--text]

Scans the code in [dir] (default: the working directory) and lists findings with file:line:

  timeout  an outbound call with no timeout and no abort signal:
             fetch(url) or fetch(url, {...}) without signal/timeout; axios(...), axios.get/post/...(...) without a
             timeout or signal in its config (skipped when the project sets axios.defaults.timeout); got(...);
             undici request(...) without headersTimeout/bodyTimeout/signal; http(s).request/get(...) without a
             timeout option or a .setTimeout(...) after it; Python requests.get/post/...(...) without timeout=,
             urlopen(...) without a timeout
  leak     a log call (console.*, logger.*, log.*, req.log.*, this.logger.*, logging.*) whose arguments carry
             a risky name (password, secret, token, apiKey, authorization, cookie, session id, connection string,
             private key, card number, cvv, ssn) or a whole object (req, request, res, ctx, user, headers, body,
             req.headers, req.body, err.config, err.request, err.response). Text inside string literals is ignored,
             so 'Invalid password' in a message is not a finding.

A config passed as a variable (fetch(url, init)) cannot be judged and is skipped, except for http(s).request, whose
default has no timeout at all.

Options:
  --base <ref>       only the lines added since <ref> (working tree and untracked files)
  --include-tests    scan test files too (skipped by default)
  --text             one finding per line instead of JSON
  --help             this text

Output (JSON): { root, base, findings: [{ file, line, kind, pattern, code }], summary: { timeout, leak } }

Limits: a client made elsewhere (axios.create, a got instance, a wrapper) is not followed; a logger with redaction
or serializers (pino redact, a pino req serializer) still shows up; judge each finding.

Exit: 0 when the scan ran (whatever it found), 2 on a usage or read error.
`;

import { inStringOf, changedSince, isAdded, isPython, isTestFile, JS_EXTS, lineIndex, maskComments, matchClose, projectRoot, PY_EXTS, read, runCli, splitTop, stripStrings, walk } from "./_common.mjs";

const RISKY = /\b(password|passwd|pwd|secret|client_?secret|token|access_?token|refresh_?token|id_?token|api_?key|apikey|authorization|cookie|cookies|session_?id|connection_?string|database_?url|private_?key|card_?number|cvv|ssn)\b/i;
const WHOLE = /^(?:req|request|res|response|ctx|context|user|currentUser|headers|body|(?:[\w$]+\.)+(?:headers|body|cookies)|(?:err|error|e|ex)\.(?:config|request|response)|c\.req(?:\.raw)?)$/;
const LOG_CALL = /(?<![\w$])(console\s*\.\s*(?:log|info|warn|error|debug|trace)|(?:[\w$]+\s*\.\s*)*(?:logger|log|logging|_logger|LOGGER)\s*\.\s*(?:info|warn|warning|error|debug|trace|fatal|log|verbose|critical|exception))\s*\(/g;
const HAS_TIMEOUT = /\b(timeout|signal|headersTimeout|bodyTimeout|AbortSignal)\b/;

/** true when a config argument sets a timeout or signal, false when it is a literal without one, null when unknown. */
function configOk(arg, code) {
  if (arg === undefined) return false;
  const a = arg.trim();
  if (a.startsWith("{")) return HAS_TIMEOUT.test(a) ? true : /\.\.\./.test(a) ? null : false;
  if (HAS_TIMEOUT.test(a)) return true;
  const ident = /^[A-Za-z_$][\w$]*$/.exec(a)?.[0];
  if (ident) {
    const def = new RegExp(`\\b${ident}\\s*(?::[^=]*)?=\\s*\\{`).exec(code);
    if (def) {
      const open = code.indexOf("{", def.index + def[0].length - 1);
      const close = matchClose(code, open);
      if (close > 0) return HAS_TIMEOUT.test(code.slice(open, close));
    }
  }
  return null;
}

function scanFile(file, src, ctx) {
  const python = isPython(file);
  const code = maskComments(src, python);
  const inString = inStringOf(code, python);
  const line = lineIndex(code);
  const lines = src.split("\n");
  const findings = [];
  const add = (index, kind, pattern) => {
    const n = line(index);
    findings.push({ file, line: n, kind, pattern, code: (lines[n - 1] ?? "").trim().slice(0, 160) });
  };
  const callAt = (m) => {
    const open = m.index + m[0].length - 1;
    const close = matchClose(code, open, python);
    if (close < 0) return null;
    const isDefinition = /^\s*(?::[^{;]*)?\{/.test(code.slice(close + 1, close + 80)) && !python;
    return { args: splitTop(code.slice(open + 1, close), python), text: code.slice(open + 1, close), close, isDefinition };
  };

  if (!python) {
    for (const m of code.matchAll(/(?<![.\w$])(?:globalThis\s*\.\s*|window\s*\.\s*)?fetch\s*\(/g)) if (!inString(m.index)) {
      const c = callAt(m);
      if (!c || c.isDefinition || c.args.length === 0) continue;
      if (configOk(c.args[1], code) === false) add(m.index, "timeout", "fetch without a timeout or signal");
    }
    if (!ctx.axiosDefaults) {
      for (const m of code.matchAll(/(?<![.\w$])axios(?:\s*\.\s*(get|delete|head|options|post|put|patch|request))?\s*\(/g)) if (!inString(m.index)) {
        const c = callAt(m);
        if (!c || c.args.length === 0) continue;
        const pos = !m[1] ? (c.args[0].startsWith("{") ? 0 : 1) : m[1] === "request" ? 0 : ["post", "put", "patch"].includes(m[1]) ? 2 : 1;
        if (configOk(c.args[pos], code) === false) add(m.index, "timeout", `axios${m[1] ? `.${m[1]}` : ""} without a timeout or signal`);
      }
    }
    for (const m of code.matchAll(/(?<![.\w$])got(?:\s*\.\s*(get|post|put|patch|delete|head))?\s*\(/g)) if (!inString(m.index)) {
      const c = callAt(m);
      if (!c || c.isDefinition || c.args.length === 0) continue;
      if (configOk(c.args[0].startsWith("{") ? c.args[0] : c.args[1], code) === false) add(m.index, "timeout", "got without a timeout or signal");
    }
    if (/from\s+["']undici["']|require\(\s*["']undici["']\s*\)/.test(code)) {
      for (const m of code.matchAll(/(?<![.\w$])(?:undici\s*\.\s*)?request\s*\(/g)) if (!inString(m.index)) {
        const c = callAt(m);
        if (!c || c.isDefinition || c.args.length === 0) continue;
        if (configOk(c.args[1], code) === false) add(m.index, "timeout", "undici request without headersTimeout, bodyTimeout or signal");
      }
    }
    for (const m of code.matchAll(/(?<![.\w$])https?\s*\.\s*(request|get)\s*\(/g)) if (!inString(m.index)) {
      const c = callAt(m);
      if (!c || c.args.length === 0) continue;
      const after = code.slice(c.close, c.close + 400);
      const ok = c.args.some((a) => configOk(a, code) === true) || /\.setTimeout\s*\(|\.on\s*\(\s*["']timeout["']/.test(after);
      if (!ok) add(m.index, "timeout", `http.${m[1]} without a timeout`);
    }
  } else {
    for (const m of code.matchAll(/\brequests\s*\.\s*(get|post|put|patch|delete|head|options|request)\s*\(/g)) if (!inString(m.index)) {
      const c = callAt(m);
      if (!c || /\btimeout\s*=/.test(c.text) || /\*\*/.test(c.text)) continue;
      add(m.index, "timeout", `requests.${m[1]} without timeout=`);
    }
    for (const m of code.matchAll(/\burlopen\s*\(/g)) if (!inString(m.index)) {
      const c = callAt(m);
      if (!c || /\btimeout\s*=/.test(c.text) || c.args.length >= 3) continue;
      add(m.index, "timeout", "urlopen without a timeout");
    }
  }

  for (const m of code.matchAll(LOG_CALL)) if (!inString(m.index)) {
    const c = callAt(m);
    if (!c || c.isDefinition) continue;
    const reasons = [];
    const stripped = stripStrings(c.text, python);
    const risky = RISKY.exec(stripped);
    if (risky) reasons.push(`a risky name: ${risky[1]}`);
    for (const arg of splitTop(stripped, python)) {
      const values = arg.startsWith("{") && !python ? splitTop(arg.slice(1, -1)).map((e) => (/^[\w$]+\s*:/.test(e) ? e.replace(/^[\w$]+\s*:\s*/, "") : e)) : [arg];
      const whole = values.map((v) => v.trim()).find((v) => WHOLE.test(v));
      if (whole) { reasons.push(`a whole object: ${whole}`); break; }
    }
    if (reasons.length) add(m.index, "leak", `log call with ${reasons.join("; ")}`);
  }
  return findings;
}

await runCli({
  help: HELP,
  options: { base: { type: "string" }, "include-tests": { type: "boolean" } },
  main(values, positionals) {
    const root = projectRoot(positionals);
    const changed = values.base ? changedSince(root, values.base) : null;
    const files = walk(root, [...JS_EXTS, ...PY_EXTS]).filter((f) => values["include-tests"] || !isTestFile(f));
    const sources = files.map((file) => ({ file, src: read(root, file) }));
    const ctx = { axiosDefaults: sources.some((s) => /axios\.defaults\.timeout\s*=/.test(s.src)) };
    const findings = [];
    for (const { file, src } of sources) {
      if (changed && !changed.has(file)) continue;
      for (const f of scanFile(file, src, ctx)) if (!changed || isAdded(changed, f.file, f.line)) findings.push(f);
    }
    findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind));
    return {
      root,
      base: values.base ?? null,
      findings,
      summary: { timeout: findings.filter((f) => f.kind === "timeout").length, leak: findings.filter((f) => f.kind === "leak").length },
    };
  },
  text(r) {
    return r.findings.map((f) => `${f.file}:${f.line}  ${f.kind}  ${f.pattern}`).join("\n") + (r.findings.length ? "\n" : "") + `${r.summary.timeout} timeout, ${r.summary.leak} leak\n`;
  },
});
