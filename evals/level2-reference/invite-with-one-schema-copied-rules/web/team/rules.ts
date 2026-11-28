/** The rules of an invitation as the form applies them (the server has its own). */
const NAME_MAX = 80;

export function inviteFieldErrors(input: { name: string; email: string }): Record<string, string> | null {
  const fields: Record<string, string> = {};
  const name = input.name.trim();
  if (!name) fields.name = "required";
  else if (name.length > NAME_MAX) fields.name = "too-long";
  const email = input.email.trim();
  if (!email) fields.email = "required";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = "invalid";
  return Object.keys(fields).length ? fields : null;
}
