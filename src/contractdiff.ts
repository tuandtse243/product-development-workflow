/**
 * Classifies how a contract changed after the gate (ADR-0014, a Deviation): additive (what was there still holds) or
 * breaking (something a client, a caller or a row relies on is gone or different). Deterministic and conservative:
 * whatever it cannot tell apart counts as breaking.
 *
 *   OpenAPI   operations (path + method), parameters, request bodies, responses and schemas (properties, required,
 *             type, enum, $ref)
 *   DBML      tables, columns (type, a new NOT NULL column without a default), enums
 */
import YAML from "yaml";
import type { ContractClass } from "./deviationrecord.js";

export interface Classified {
  class: ContractClass;
  changes: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const METHODS = ["get", "put", "post", "delete", "patch", "options", "head", "trace"];

class Collector {
  breaking: string[] = [];
  additive: string[] = [];
  b(s: string) {
    this.breaking.push(s);
  }
  a(s: string) {
    this.additive.push(s);
  }
  result(): Classified {
    const changes = [...this.breaking.map((s) => `breaking: ${s}`), ...this.additive.map((s) => `additive: ${s}`)];
    return { class: this.breaking.length ? "breaking" : this.additive.length ? "additive" : "none", changes };
  }
}

function parseYaml(text: string | null): unknown {
  if (text === null) return null;
  try {
    return YAML.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const typeOf = (s: Record<string, unknown>): string => (Array.isArray(s.type) ? [...(s.type as unknown[])].map(String).sort().join("|") : String(s.type ?? ""));

/** Schema difference. `side`: request (what callers send) or response (what callers read); "both" for shared components. */
function diffSchema(before: unknown, after: unknown, where: string, side: "request" | "response" | "both", c: Collector, depth = 0): void {
  if (depth > 12) return;
  if (!isRecord(before) || !isRecord(after)) {
    if (isRecord(before) !== isRecord(after)) (isRecord(before) ? c.b(`${where}: schema removed`) : c.a(`${where}: schema added`));
    return;
  }
  if ((before.$ref ?? null) !== (after.$ref ?? null)) {
    c.b(`${where}: schema reference changed from ${String(before.$ref ?? "inline")} to ${String(after.$ref ?? "inline")}`);
    return;
  }
  if (typeOf(before) !== typeOf(after)) c.b(`${where}: type changed from ${typeOf(before) || "any"} to ${typeOf(after) || "any"}`);
  if (Array.isArray(before.enum) || Array.isArray(after.enum)) {
    const bv = new Set((Array.isArray(before.enum) ? before.enum : []).map((x) => JSON.stringify(x)));
    const av = new Set((Array.isArray(after.enum) ? after.enum : []).map((x) => JSON.stringify(x)));
    for (const v of bv) if (!av.has(v)) c.b(`${where}: enum value ${v} removed`);
    for (const v of av) if (!bv.has(v)) c.a(`${where}: enum value ${v} added`);
  }
  const bp = isRecord(before.properties) ? before.properties : {};
  const ap = isRecord(after.properties) ? after.properties : {};
  const breq = new Set(Array.isArray(before.required) ? before.required.map(String) : []);
  const areq = new Set(Array.isArray(after.required) ? after.required.map(String) : []);
  for (const k of Object.keys(bp)) {
    if (!(k in ap)) c.b(`${where}.${k}: property removed`);
    else diffSchema(bp[k], ap[k], `${where}.${k}`, side, c, depth + 1);
  }
  for (const k of Object.keys(ap)) {
    if (k in bp) continue;
    if (areq.has(k) && side !== "response") c.b(`${where}.${k}: new required property`);
    else c.a(`${where}.${k}: property added`);
  }
  for (const k of areq) if (!breq.has(k) && k in bp && side !== "response") c.b(`${where}.${k}: now required`);
  for (const k of breq) if (!areq.has(k) && k in ap && side !== "request") c.b(`${where}.${k}: no longer required (a reader may miss it)`);
  if (before.items !== undefined || after.items !== undefined) diffSchema(before.items, after.items, `${where}[]`, side, c, depth + 1);
}

const paramKey = (x: Record<string, unknown>) => `${String(x.in ?? "")}:${String(x.name ?? x.$ref ?? "")}`;
function params(pathItem: Record<string, unknown>, op: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const list of [pathItem.parameters, op.parameters]) for (const x of Array.isArray(list) ? list : []) if (isRecord(x)) out.set(paramKey(x), x);
  return out;
}

function bodySchemas(body: unknown): Map<string, unknown> {
  const content = isRecord(body) && isRecord(body.content) ? body.content : {};
  return new Map(Object.entries(content).map(([type, m]) => [type, isRecord(m) ? m.schema : undefined]));
}

function diffOperation(name: string, pb: Record<string, unknown>, pa: Record<string, unknown>, ob: Record<string, unknown>, oa: Record<string, unknown>, c: Collector): void {
  const before = params(pb, ob);
  const after = params(pa, oa);
  for (const [k, x] of before) {
    const y = after.get(k);
    if (!y) c.b(`${name}: parameter ${k} removed`);
    else {
      if (y.required === true && x.required !== true) c.b(`${name}: parameter ${k} now required`);
      diffSchema(x.schema, y.schema, `${name} parameter ${k}`, "request", c);
    }
  }
  for (const [k, y] of after) if (!before.has(k)) (y.required === true ? c.b(`${name}: new required parameter ${k}`) : c.a(`${name}: optional parameter ${k} added`));
  if (ob.requestBody !== undefined || oa.requestBody !== undefined) {
    if (!isRecord(oa.requestBody)) c.b(`${name}: request body removed`);
    else if (!isRecord(ob.requestBody)) (oa.requestBody.required === true ? c.b(`${name}: required request body added`) : c.a(`${name}: optional request body added`));
    else {
      if (oa.requestBody.required === true && ob.requestBody.required !== true) c.b(`${name}: request body now required`);
      const bs = bodySchemas(ob.requestBody);
      const as = bodySchemas(oa.requestBody);
      for (const [t, s] of bs) (as.has(t) ? diffSchema(s, as.get(t), `${name} request ${t}`, "request", c) : c.b(`${name}: request type ${t} no longer accepted`));
      for (const t of as.keys()) if (!bs.has(t)) c.a(`${name}: request type ${t} accepted`);
    }
  }
  const rb = isRecord(ob.responses) ? ob.responses : {};
  const ra = isRecord(oa.responses) ? oa.responses : {};
  for (const code of Object.keys(rb)) {
    if (!(code in ra)) {
      c.b(`${name}: response ${code} removed`);
      continue;
    }
    const bs = bodySchemas(rb[code]);
    const as = bodySchemas(ra[code]);
    for (const [t, s] of bs) (as.has(t) ? diffSchema(s, as.get(t), `${name} ${code} ${t}`, "response", c) : c.b(`${name}: response ${code} no longer ${t}`));
    for (const t of as.keys()) if (!bs.has(t)) c.a(`${name}: response ${code} also ${t}`);
  }
  for (const code of Object.keys(ra)) if (!(code in rb)) c.a(`${name}: response ${code} added`);
}

export function classifyOpenApi(beforeText: string | null, afterText: string | null): Classified {
  const c = new Collector();
  const before = parseYaml(beforeText);
  const after = parseYaml(afterText);
  if (before === undefined || after === undefined) {
    c.b(`${after === undefined ? "the new" : "the approved"} contract is not valid YAML`);
    return c.result();
  }
  if (!isRecord(before) || !isRecord(after)) {
    if (isRecord(before)) c.b("contract removed");
    else if (isRecord(after)) c.a("contract added");
    return c.result();
  }
  const pb = isRecord(before.paths) ? before.paths : {};
  const pa = isRecord(after.paths) ? after.paths : {};
  for (const path of new Set([...Object.keys(pb), ...Object.keys(pa)])) {
    const ib = isRecord(pb[path]) ? (pb[path] as Record<string, unknown>) : {};
    const ia = isRecord(pa[path]) ? (pa[path] as Record<string, unknown>) : {};
    for (const m of METHODS) {
      const ob = ib[m];
      const oa = ia[m];
      const name = `${m.toUpperCase()} ${path}`;
      if (isRecord(ob) && !isRecord(oa)) c.b(`${name}: operation removed`);
      else if (!isRecord(ob) && isRecord(oa)) c.a(`${name}: operation added`);
      else if (isRecord(ob) && isRecord(oa)) diffOperation(name, ib, ia, ob, oa, c);
    }
  }
  const sb = isRecord(before.components) && isRecord(before.components.schemas) ? before.components.schemas : {};
  const sa = isRecord(after.components) && isRecord(after.components.schemas) ? after.components.schemas : {};
  for (const k of Object.keys(sb)) (k in sa ? diffSchema(sb[k], sa[k], `schema ${k}`, "both", c) : c.b(`schema ${k} removed`));
  for (const k of Object.keys(sa)) if (!(k in sb)) c.a(`schema ${k} added`);
  return c.result();
}

// ---------------------------------------------------------------- DBML

interface Column {
  type: string;
  settings: string;
}

/** Tables (name -> columns) and enums (name -> values) of a DBML file; comments, notes, indexes and refs are skipped. */
export function parseDbml(text: string): { tables: Map<string, Map<string, Column>>; enums: Map<string, Set<string>> } {
  const tables = new Map<string, Map<string, Column>>();
  const enums = new Map<string, Set<string>>();
  const lines = text.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, "").trim());
  let table: Map<string, Column> | null = null;
  let en: Set<string> | null = null;
  let nested = 0;
  const unquote = (s: string) => s.replace(/^["'`]|["'`]$/g, "");
  for (const l of lines) {
    if (!l) continue;
    if (!table && !en) {
      const t = /^table\s+("[^"]+"|[\w.]+)(?:\s+as\s+\w+)?\s*(?:\[[^\]]*\])?\s*\{$/i.exec(l);
      const e = /^enum\s+("[^"]+"|[\w.]+)\s*\{$/i.exec(l);
      if (t) tables.set(unquote(t[1] as string).toLowerCase(), (table = new Map()));
      else if (e) enums.set(unquote(e[1] as string).toLowerCase(), (en = new Set()));
      continue;
    }
    if (nested > 0) {
      if (l.includes("{")) nested++;
      if (l.includes("}")) nested--;
      continue;
    }
    if (l.startsWith("}")) {
      table = null;
      en = null;
      continue;
    }
    if (/^(?:indexes|note)\s*:?\s*\{/i.test(l)) {
      if (!l.includes("}")) nested = 1;
      continue;
    }
    if (/^note\s*:/i.test(l)) continue;
    if (en) {
      const v = /^("[^"]+"|[\w-]+)/.exec(l);
      if (v) en.add(unquote(v[1] as string));
      continue;
    }
    const col = /^("[^"]+"|[\w]+)\s+("[^"]+"|[\w.()," ]+?)\s*(\[.*\])?$/.exec(l);
    if (col && table) table.set(unquote(col[1] as string).toLowerCase(), { type: (col[2] as string).replace(/\s+/g, "").toLowerCase(), settings: (col[3] ?? "").toLowerCase() });
  }
  return { tables, enums };
}

/** Why a DBML file cannot be read as written (unbalanced braces: still being edited), or null. */
export function dbmlProblem(text: string): string | null {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/'[^'\n]*'|"[^"\n]*"/g, "");
  let depth = 0;
  for (const ch of clean) {
    if (ch === "{") depth++;
    else if (ch === "}" && --depth < 0) return "not valid DBML (a closing brace with no opening one)";
  }
  return depth === 0 ? null : "not valid DBML (a block is not closed)";
}

export function classifyDbml(beforeText: string | null, afterText: string | null): Classified {
  const c = new Collector();
  const before = parseDbml(beforeText ?? "");
  const after = parseDbml(afterText ?? "");
  for (const [name, cols] of before.tables) {
    const now = after.tables.get(name);
    if (!now) {
      c.b(`table ${name} removed`);
      continue;
    }
    for (const [col, x] of cols) {
      const y = now.get(col);
      if (!y) c.b(`${name}.${col}: column removed`);
      else {
        if (x.type !== y.type) c.b(`${name}.${col}: type changed from ${x.type} to ${y.type}`);
        if (/not null/.test(y.settings) && !/not null/.test(x.settings)) c.b(`${name}.${col}: now NOT NULL`);
        if (/\bunique\b/.test(y.settings) && !/\bunique\b/.test(x.settings)) c.b(`${name}.${col}: now unique`);
      }
    }
    for (const [col, y] of now) {
      if (cols.has(col)) continue;
      const strict = /not null|\bpk\b|primary key/.test(y.settings) && !/default\s*:/.test(y.settings) && !/increment/.test(y.settings);
      (strict ? c.b(`${name}.${col}: new NOT NULL column without a default`) : c.a(`${name}.${col}: column added`));
    }
  }
  for (const name of after.tables.keys()) if (!before.tables.has(name)) c.a(`table ${name} added`);
  for (const [name, values] of before.enums) {
    const now = after.enums.get(name);
    if (!now) c.b(`enum ${name} removed`);
    else {
      for (const v of values) if (!now.has(v)) c.b(`enum ${name}: value ${v} removed`);
      for (const v of now) if (!values.has(v)) c.a(`enum ${name}: value ${v} added`);
    }
  }
  for (const name of after.enums.keys()) if (!before.enums.has(name)) c.a(`enum ${name} added`);
  return c.result();
}
