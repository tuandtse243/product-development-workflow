import { inviteSchema, type Invite, type InviteRequest } from "../../shared/invites.ts";
import { postJson } from "../api/client";

/** Invites a person to the signed-in owner's team (`POST /api/invites`). */
export async function sendInvite(input: InviteRequest, signal?: AbortSignal): Promise<Invite> {
  return inviteSchema.parse(await postJson("/api/invites", input, { signal }));
}
