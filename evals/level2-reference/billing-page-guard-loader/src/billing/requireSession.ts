import { redirect } from "react-router";
import { ApiError } from "../api/client";
import { getSession, type SessionUser } from "./api";

/** For a loader: the signed-in user, or a redirect to /login that remembers where the visitor was going. */
export async function requireSession(path: string): Promise<SessionUser> {
  try {
    return (await getSession()).user;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw redirect(`/login?next=${encodeURIComponent(path)}`);
    throw e;
  }
}
