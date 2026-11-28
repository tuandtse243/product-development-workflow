import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { getSession, type SessionUser } from "./api";

export type Session = { status: "checking" } | { status: "signed-out" } | { status: "failed" } | { status: "signed-in"; user: SessionUser };

/** Who the API says is signed in. The browser's own storage is never asked. `retry` asks again after a failure. */
export function useSession() {
  const [session, setSession] = useState<Session>({ status: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    setSession({ status: "checking" });
    getSession(ac.signal)
      .then(({ user }) => {
        if (!ac.signal.aborted) setSession({ status: "signed-in", user });
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setSession(e instanceof ApiError && e.status === 401 ? { status: "signed-out" } : { status: "failed" });
      });
    return () => ac.abort();
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { session, retry };
}
