import { z } from "zod";

/**
 * The rules of an invitation and the shape of one, used by the web form and by the API alike. Imported by `server/` and
 * `web/`, so nothing here may import the database, Express or any other server-only module.
 */
export const INVITE_NAME_MAX = 80;

const required = { required_error: "required", invalid_type_error: "required" };

/** The request body: the reason a field is refused is the issue's message (`required`, `too-long`, `invalid`). */
export const inviteRequestSchema = z.object({
  name: z.string(required).trim().min(1, "required").max(INVITE_NAME_MAX, "too-long"),
  email: z.string(required).trim().min(1, "required").email("invalid"),
});
export type InviteRequest = z.infer<typeof inviteRequestSchema>;

/** One reason per field at fault, or null when the input is as the rules want it. */
export function inviteFieldErrors(input: unknown): Record<string, string> | null {
  const r = inviteRequestSchema.safeParse(input);
  if (r.success) return null;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const field = String(issue.path[0] ?? "body");
    fields[field] ??= issue.message;
  }
  return fields;
}

/** An invitation as the API sends it. */
export const inviteSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  email: z.string(),
  name: z.string(),
  createdAt: z.string(),
});
export type Invite = z.infer<typeof inviteSchema>;
