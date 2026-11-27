import { useCallback, useEffect, useRef, useState } from "react";
import { searchPeople, type Person } from "./api";

export type Search = { status: "idle" } | { status: "searching" } | { status: "failed" } | { status: "found"; people: Person[] };

/** Ignores the answer of an older text, counting only the searches it sends: emptying the box sends none, so it counts nothing. */
export function usePeopleSearch(text: string) {
  const [search, setSearch] = useState<Search>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (!text) {
      setSearch({ status: "idle" });
      return;
    }
    const mine = ++latest.current;
    setSearch({ status: "searching" });
    searchPeople(text)
      .then((people) => {
        if (mine === latest.current) setSearch({ status: "found", people });
      })
      .catch(() => {
        if (mine === latest.current) setSearch({ status: "failed" });
      });
  }, [text, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { search, retry };
}
