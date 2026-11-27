import type { ZodType, ZodTypeDef } from "zod";
import { invalidRequest } from "./errors.ts";

/** Parses input with a schema; a mismatch is `400 invalid-request` naming the fields at fault (never their values). */
export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, input: unknown): T {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const fields = [...new Set(r.error.issues.map((i) => i.path.join(".") || (i.code === "unrecognized_keys" ? i.keys.join(", ") : "body")))];
  throw invalidRequest(`check: ${fields.join(", ")}`);
}
