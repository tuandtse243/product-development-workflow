import { useEffect, useState, type DependencyList } from "react";

/**
 * Loads data for a view: `load` runs when a dependency changes and is aborted when the view leaves or the dependencies
 * change before it finished. While it runs, `loading` is true and `data` keeps its previous value (`initial` at first).
 */
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, deps: DependencyList, initial: T): { data: T; loading: boolean } {
  const [state, setState] = useState<{ data: T; loading: boolean }>({ data: initial, loading: true });
  useEffect(() => {
    const ac = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    load(ac.signal)
      .then((data) => {
        if (!ac.signal.aborted) setState({ data, loading: false });
      })
      .catch(() => {
        if (!ac.signal.aborted) setState({ data: initial, loading: false });
      });
    return () => ac.abort();
  }, deps); // the caller names what the load depends on
  return state;
}
