import { z } from "zod";

/**
 * Every error answer of the API: `{ "error": { "code", "message"?, "fields"? } }`. `code` is the short name the API
 * contract gives the error; `fields` (a 422 `validation`) maps a field name to the reason it was refused.
 */
export const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string().optional(),
    fields: z.record(z.string()).optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;
