import { useCallback, useEffect, useState } from "react";
import { searchPeople, type Person } from "./api";

export type Search = { status: "idle" } | { status: "searching" } | { status: "failed" } | { status: "found"; people: Person[] };

/** Copies the neighbour's useFetch: an effect that fetches and sets state when the answer arrives, whichever it is. */
export function usePeopleSearch(text: string) {
  const [search, setSearch] = useState<Search>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!text) {
      setSearch({ status: "idle" });
      return;
    }
    setSearch({ status: "searching" });
    searchPeople(text)
      .then((people) => setSearch({ status: "found", people }))
      .catch(() => setSearch({ status: "failed" }));
  }, [text, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { search, retry };
}
