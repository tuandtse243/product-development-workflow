import { useCallback, useEffect, useRef, useState } from "react";
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
  const latest = useRef(0);

  useEffect(() => {
    if (!text) return;
    const id = ++latest.current;
    setResult({ status: "searching" });
    searchPeople(text)
      .then((people) => {
        if (id === latest.current) setResult({ status: "found", people });
      })
      .catch(() => {
        if (id === latest.current) setResult({ status: "failed" });
      });
    return () => {
      // a newer text, or an empty one, makes every earlier answer stale
      latest.current++;
    };
  }, [text, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { search: text ? result : IDLE, retry };
}
