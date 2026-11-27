import { useCallback, useEffect, useState } from "react";
import { searchPeople, type Person } from "./api";

export type Search = { status: "idle" } | { status: "searching" } | { status: "failed" } | { status: "found"; people: Person[] };

const IDLE: Search = { status: "idle" };

/**
 * The people matching `text`. Each change of the text cancels the request of the one before and ignores its answer if
 * it arrives anyway; an empty text is the idle state, computed here and never stored. `retry` searches the same text again.
 */
export function usePeopleSearch(text: string) {
  const [result, setResult] = useState<Search>(IDLE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!text) return;
    const ac = new AbortController();
    setResult({ status: "searching" });
    searchPeople(text, ac.signal)
      .then((people) => {
        if (!ac.signal.aborted) setResult({ status: "found", people });
      })
      .catch(() => {
        if (!ac.signal.aborted) setResult({ status: "failed" });
      });
    return () => ac.abort();
  }, [text, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { search: text ? result : IDLE, retry };
}
