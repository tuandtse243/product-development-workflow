#!/usr/bin/env node
// error-shape-probe: do the project's error responses have the one declared error shape, and do they leak nothing?
// A backend Role tool for rule B6 (advisory). Node built-ins only.
const HELP = `
Usage: node error-shape-probe.mjs [dir] [--contract <openapi.yaml|.json> | --shape <a,b,c>] [--responses <file>] [--text]

Two probes, either or both:

1. Static (when [dir] is given, or no --responses): finds where the code in [dir] builds an error response and
   compares the keys of the body literal with the declared error shape:
     res.status(404).json({...})  res.status(500).send({...})  reply.code(409).send({...})
     NextResponse.json({...}, { status: 403 })  Response.json(...)  c.json({...}, 422)  new HttpException({...}, 400)
     JSONResponse(status_code=422, content={...})  HTTPException(status_code=404, detail=...)  JsonResponse({...}, status=400)
   and a success response that carries an error ("200 with an error inside"): res.json({ error }) with no status,
   or a 2xx status with an error, err, errorMessage, or success/ok: false member.
   Each site is kind "ok", "mismatch" (members missing), "unknown" (a spread or a variable: cannot tell) or
   "error-in-200". "extra" lists members the contract does not declare (when it declares properties).

2. Captured responses (--responses <file>): a JSON array or JSON Lines of { status, headers, body, name? } that the
   task's tests wrote. For every status >= 400: missing members, the media type (Content-Type), a body "status"
   that differs from the real one, and leak markers: "stack trace", "SQL text", "absolute path".

The declared shape, in order: --shape (required member names), --contract (the schema of the first 4xx/5xx/default
response in the OpenAPI document, else a components schema named Problem, ProblemDetails, Error, ErrorResponse,
ApiError or HttpError: its "required" and "properties", and the response's media type), else RFC 9457 problem
details (required type, title, status; also detail, instance, errors; media type application/problem+json), the
default of library/skills/api-design-rules.

Options:
  --contract <file>   an OpenAPI document (YAML in block style, or JSON)
  --shape <names>     comma-separated required member names; overrides --contract
  --responses <file>  captured responses to check
  --text              short text instead of JSON
  --help              this text

Output (JSON): { root, shape: { source, required, properties, mediaType }, sites?: [{ file, line, status, keys,
  missing, extra, kind }], responses?: [{ index, name, status, mediaType, missing, leaks, findings, kind }], summary }

Limits: a static scan sees literal bodies and literal status codes only; an error shaped by an exception filter or a
handler registered elsewhere (Nest's built-in NotFoundException, a FastAPI exception handler) is judged by the
probe of captured responses, not by the static one.

Exit: 0 when the probe ran (whatever it found), 2 on a usage or read error.
`;

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { inStringOf, isPython, isTestFile, JS_EXTS, lineIndex, maskComments, matchClose, objectKeys, projectRoot, PY_EXTS, read, runCli, splitTop, UsageError, walk } from "./_common.mjs";

const PROBLEM = { source: "default (RFC 9457 problem details)", required: ["type", "title", "status"], properties: ["type", "title", "status", "detail", "instance", "errors"], mediaType: "application/problem+json" };

// ---- A small reader for block-style YAML (what OpenAPI documents use): maps, lists, scalars, [a, b] and {a: b}.

function parseYaml(text) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const body = stripYamlComment(raw);
    if (body.trim() === "" || body.trim() === "---") continue;
    lines.push({ indent: body.search(/\S/), text: body.trim() });
  }
  let i = 0;
  const isItem = (l) => l.text === "-" || l.text.startsWith("- ");
  const block = () => (i < lines.length && isItem(lines[i]) ? list(lines[i].indent) : i < lines.length ? map(lines[i].indent) : null);
  function map(indent) {
    const obj = {};
    while (i < lines.length && lines[i].indent === indent && !isItem(lines[i])) {
      const m = /^((?:"[^"]*"|'[^']*'|[^:"'])+?)\s*:(?:\s+(.*))?$/.exec(lines[i].text);
      i++;
      if (!m) continue;
      const key = unquote(m[1].trim());
      const rest = m[2]?.trim();
      if (rest === undefined || rest === "") {
        const deeper = i < lines.length && (lines[i].indent > indent || (lines[i].indent === indent && isItem(lines[i])));
        obj[key] = deeper ? block() : null;
      } else if (/^[|>][-+]?$/.test(rest)) {
        const parts = [];
        while (i < lines.length && lines[i].indent > indent) parts.push(lines[i++].text);
        obj[key] = parts.join("\n");
      } else obj[key] = scalar(rest);
    }
    return obj;
  }
  function list(indent) {
    const arr = [];
    while (i < lines.length && lines[i].indent === indent && isItem(lines[i])) {
      const rest = lines[i].text.slice(1).trim();
      if (rest === "") { i++; arr.push(block()); continue; }
      if (/^(?:"[^"]*"|'[^']*'|[^"'[{][^:]*?)\s*:(\s|$)/.test(rest)) { lines[i] = { indent: indent + 2, text: rest }; arr.push(map(indent + 2)); continue; }
      arr.push(scalar(rest));
      i++;
    }
    return arr;
  }
  return block();
}

function stripYamlComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}
const unquote = (s) => (/^(["']).*\1$/.test(s) ? s.slice(1, -1) : s);
function scalar(s) {
  if (s.startsWith("[") && s.endsWith("]")) return splitTop(s.slice(1, -1)).map(scalar);
  if (s.startsWith("{") && s.endsWith("}")) {
    const obj = {};
    for (const part of splitTop(s.slice(1, -1))) {
      const m = /^((?:"[^"]*"|'[^']*'|[^:])+?)\s*:\s*(.*)$/.exec(part);
      if (m) obj[unquote(m[1].trim())] = scalar(m[2].trim());
    }
    return obj;
  }
  return unquote(s);
}

// ---- The declared shape from an OpenAPI document.

function pointer(doc, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  return ref.slice(2).split("/").map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~")).reduce((o, k) => (o == null ? undefined : o[k]), doc);
}

function shapeFromContract(doc, label) {
  const toShape = (schema, where, mediaType) => {
    let at = where;
    if (schema?.$ref) { at = schema.$ref; schema = pointer(doc, schema.$ref); }
    if (!schema || typeof schema !== "object") return null;
    const props = schema.properties && typeof schema.properties === "object" ? Object.keys(schema.properties) : null;
    return { source: `contract ${label}${at}`, required: Array.isArray(schema.required) ? schema.required.map(String) : [], properties: props, mediaType };
  };
  for (const [path, item] of Object.entries(doc?.paths ?? {})) {
    for (const [method, op] of Object.entries(item ?? {})) {
      for (const [code, resp0] of Object.entries(op?.responses ?? {})) {
        if (!/^([45]\d\d|[45]XX|default)$/i.test(code)) continue;
        const resp = resp0?.$ref ? pointer(doc, resp0.$ref) : resp0;
        for (const [mediaType, media] of Object.entries(resp?.content ?? {})) {
          const s = toShape(media?.schema, `#/paths/${path.replace(/\//g, "~1")}/${method}/responses/${code}`, mediaType);
          if (s) return s;
        }
        if (resp?.schema) { const s = toShape(resp.schema, `#/paths/${path}/${method}/responses/${code}`, null); if (s) return s; }
      }
    }
  }
  const schemas = doc?.components?.schemas ?? doc?.definitions ?? {};
  const name = Object.keys(schemas).find((n) => /^(Problem|ProblemDetails?|Error|ErrorResponse|ApiError|HttpError)$/i.test(n));
  if (name) return toShape(schemas[name], `#/${doc?.components ? "components/schemas" : "definitions"}/${name}`, null);
  return null;
}

// ---- Static probe.

const ERRORISH = (keys, body) => keys.some((k) => /^(error|err|errorMessage|error_message)$/.test(k)) || /\b(success|ok)\s*:\s*(false|False)\b/.test(body);

function judge(shape, keys, spread, status, body) {
  if (status !== null && status < 400) return keys !== null && ERRORISH(keys, body) ? { missing: [], extra: [], kind: "error-in-200" } : null;
  if (keys === null) return { missing: [], extra: [], kind: "unknown" };
  const missing = shape.required.filter((k) => !keys.includes(k));
  const extra = shape.properties && !spread ? keys.filter((k) => !shape.properties.includes(k)) : [];
  if (spread && missing.length) return { missing: [], extra, kind: "unknown" };
  return { missing, extra, kind: missing.length ? "mismatch" : "ok" };
}

function staticSites(file, src, shape) {
  const python = isPython(file);
  const code = maskComments(src, python);
  const inString = inStringOf(code, python);
  const line = lineIndex(code);
  const sites = [];
  const args = (open) => { const close = matchClose(code, open, python); return close < 0 ? null : splitTop(code.slice(open + 1, close), python); };
  const site = (index, status, bodyArg) => {
    const body = bodyArg?.trim() ?? "";
    let keys = null, spread = false;
    if (body.startsWith("{")) {
      const close = matchClose(body, 0, python);
      if (close > 0) ({ keys, spread } = objectKeys(body.slice(1, close), python));
    }
    const verdict = judge(shape, keys, spread, status, body);
    if (verdict) sites.push({ file, line: line(index), status, keys, ...verdict });
  };
  const num = (s) => (s !== undefined && /^\d{3}$/.test(s.trim()) ? Number(s.trim()) : null);
  if (!python) {
    for (const m of code.matchAll(/\.\s*(?:status|code)\s*\(\s*(\d{3})\s*\)\s*\.\s*(?:json|send)\s*\(/g)) if (!inString(m.index)) site(m.index, Number(m[1]), args(m.index + m[0].length - 1)?.[0]);
    for (const m of code.matchAll(/(?<![.\w$])(?:res|response|reply)\s*\.\s*(?:json|send)\s*\(\s*\{/g)) if (!inString(m.index)) {
      const a = args(code.indexOf("(", m.index));
      if (a && ERRORISH(objectKeys(a[0].slice(1, -1)).keys, a[0])) site(m.index, 200, a[0]);
    }
    for (const m of code.matchAll(/\b(?:NextResponse|Response)\s*\.\s*json\s*\(/g)) if (!inString(m.index)) {
      const a = args(m.index + m[0].length - 1);
      if (!a) continue;
      const status = num(/\bstatus\s*:\s*(\d{3})\b/.exec(a[1] ?? "")?.[1]);
      site(m.index, status ?? 200, a[0]);
    }
    for (const m of code.matchAll(/(?<![.\w$])(?:c|ctx|context)\s*\.\s*json\s*\(/g)) if (!inString(m.index)) {
      const a = args(m.index + m[0].length - 1);
      if (a) site(m.index, num(a[1]) ?? 200, a[0]);
    }
    for (const m of code.matchAll(/\bnew\s+HttpException\s*\(/g)) if (!inString(m.index)) {
      const a = args(m.index + m[0].length - 1);
      if (a && a[0].startsWith("{")) site(m.index, num(a[1]), a[0]);
    }
  } else {
    const kw = (a, name) => a.find((x) => new RegExp(`^${name}\\s*=`).test(x))?.replace(/^\w+\s*=\s*/, "");
    for (const m of code.matchAll(/\bJSONResponse\s*\(/g)) if (!inString(m.index)) {
      const a = args(m.index + m[0].length - 1);
      if (a) site(m.index, num(kw(a, "status_code")) ?? 200, kw(a, "content") ?? a.find((x) => !/^\w+\s*=/.test(x)));
    }
    for (const m of code.matchAll(/\bJsonResponse\s*\(/g)) if (!inString(m.index)) {
      const a = args(m.index + m[0].length - 1);
      if (a) site(m.index, num(kw(a, "status")) ?? 200, a[0]);
    }
    for (const m of code.matchAll(/\bHTTPException\s*\(/g)) if (!inString(m.index)) {
      const a = args(m.index + m[0].length - 1);
      if (a) site(m.index, num(kw(a, "status_code") ?? a[0]), "{detail: 1}");
    }
  }
  return sites;
}

// ---- Probe of captured responses.

const LEAKS = [
  ["stack trace", /\bat\s+[\w$.<>[\] ]+?\s+\(?[^\s()]+:\d+:\d+\)?|Traceback \(most recent call last\)|File "[^"]+", line \d+/],
  ["SQL text", /\bSELECT\s[\s\S]{0,300}?\bFROM\b|\bINSERT\s+INTO\b|\bUPDATE\s+\S+\s+SET\b|\bDELETE\s+FROM\b|SQLSTATE|syntax error at or near|duplicate key value violates|\bER_[A-Z_]{3,}|\bORA-\d{5}|\bSQLITE_[A-Z]+/],
  ["absolute path", /(?:^|[\s"'(=:])(?:\/(?:Users|home|var|usr|opt|srv|app|tmp|root|etc)\/[^\s"')]+|[A-Za-z]:\\[^\s"']+)|node_modules[\\/]/],
];

function readResponses(file) {
  if (!existsSync(file)) throw new UsageError(`no responses file at ${file}`);
  const text = readFileSync(file, "utf8").trim();
  try {
    const all = text.startsWith("[") ? JSON.parse(text) : text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
    if (!Array.isArray(all)) throw new Error("not a list");
    return all;
  } catch (e) {
    throw new UsageError(`${file}: not a JSON array or JSON Lines of responses (${e.message})`);
  }
}

function probeResponse(shape, r, index) {
  const status = Number(r?.status);
  const headers = Object.fromEntries(Object.entries(r?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const mediaType = headers["content-type"]?.split(";")[0].trim().toLowerCase() ?? null;
  let body = r?.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { /* keep the text */ } }
  const findings = [];
  const isObject = body !== null && typeof body === "object" && !Array.isArray(body);
  const missing = isObject ? shape.required.filter((k) => !(k in body)) : [...shape.required];
  if (!isObject) findings.push("the body is not a JSON object");
  if (missing.length) findings.push(`missing members: ${missing.join(", ")}`);
  if (shape.mediaType ? mediaType !== shape.mediaType.toLowerCase() : !/[/+]json$/.test(mediaType ?? "")) {
    findings.push(`media type ${mediaType ?? "(none)"}, expected ${shape.mediaType ?? "a JSON type"}`);
  }
  if (isObject && "status" in body && Number(body.status) !== status) findings.push(`body status ${body.status} differs from the response status ${status}`);
  const text = typeof r?.body === "string" ? r.body : JSON.stringify(r?.body ?? "");
  const leaks = LEAKS.filter(([, re]) => re.test(text)).map(([name]) => name);
  for (const l of leaks) findings.push(`leaks ${l}`);
  return { index, name: r?.name ?? null, status, mediaType, missing, leaks, findings, kind: findings.length ? "mismatch" : "ok" };
}

await runCli({
  help: HELP,
  options: { contract: { type: "string" }, shape: { type: "string" }, responses: { type: "string" } },
  main(values, positionals) {
    const root = positionals.length || !values.responses ? projectRoot(positionals) : null;
    let shape = PROBLEM;
    if (values.shape) {
      shape = { source: "--shape", required: values.shape.split(",").map((s) => s.trim()).filter(Boolean), properties: null, mediaType: null };
    } else if (values.contract) {
      if (!existsSync(values.contract)) throw new UsageError(`no contract at ${values.contract}`);
      const text = readFileSync(values.contract, "utf8");
      let doc;
      try { doc = /\.json$/i.test(values.contract) ? JSON.parse(text) : parseYaml(text); } catch (e) { throw new UsageError(`${values.contract}: cannot read (${e.message})`); }
      const abs = resolve(values.contract);
      const rel = root && !relative(resolve(root), abs).startsWith("..") && !isAbsolute(relative(resolve(root), abs)) ? relative(resolve(root), abs) : values.contract;
      shape = shapeFromContract(doc, rel) ?? { ...PROBLEM, source: `default (RFC 9457 problem details): no error schema found in ${rel}` };
    }
    const result = { root, shape };
    const summary = {};
    if (root) {
      const sites = [];
      for (const file of walk(root, [...JS_EXTS, ...PY_EXTS])) if (!isTestFile(file)) sites.push(...staticSites(file, read(root, file), shape));
      result.sites = sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
      Object.assign(summary, { sites: sites.length, mismatch: sites.filter((s) => s.kind === "mismatch").length, errorIn200: sites.filter((s) => s.kind === "error-in-200").length, unknown: sites.filter((s) => s.kind === "unknown").length });
    }
    if (values.responses) {
      const all = readResponses(values.responses);
      result.responses = all.map((r, i) => [r, i]).filter(([r]) => Number(r?.status) >= 400).map(([r, i]) => probeResponse(shape, r, i));
      Object.assign(summary, { responses: result.responses.length, responseMismatch: result.responses.filter((r) => r.kind === "mismatch").length });
    }
    result.summary = summary;
    return result;
  },
  text(r) {
    const out = [`shape: ${r.shape.source}; required ${r.shape.required.join(", ") || "(none)"}`];
    for (const s of r.sites ?? []) if (s.kind !== "ok") out.push(`${s.file}:${s.line}  ${s.status ?? "?"}  ${s.kind}${s.missing.length ? `  missing ${s.missing.join(", ")}` : ""}${s.extra.length ? `  extra ${s.extra.join(", ")}` : ""}`);
    for (const x of r.responses ?? []) if (x.kind !== "ok") out.push(`response ${x.name ?? `#${x.index}`}  ${x.status}  ${x.findings.join("; ")}`);
    out.push(Object.entries(r.summary).map(([k, v]) => `${k} ${v}`).join(", "));
    return out.join("\n") + "\n";
  },
});
