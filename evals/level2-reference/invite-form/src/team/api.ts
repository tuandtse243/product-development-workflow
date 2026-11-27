import { postJson } from "../api/client";

export interface InvitationRequest {
  name: string;
  email: string;
}

/** One field at fault in a 422 answer of POST /api/invitations. */
export interface FieldError {
  field: "name" | "email";
  message: string;
}

export const sendInvitation = (body: InvitationRequest) => postJson<{ id: string }>("/api/invitations", body);

/** The `errors` of a 422 problem body, as the contract names them; anything else is no field error. */
export function fieldErrorsOf(body: unknown): FieldError[] {
  const errors = body && typeof body === "object" ? (body as { errors?: unknown }).errors : null;
  if (!Array.isArray(errors)) return [];
  return errors.filter((e): e is FieldError => !!e && (e.field === "name" || e.field === "email") && typeof e.message === "string");
}
