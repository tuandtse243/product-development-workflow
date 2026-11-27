import { useEffect, useState } from "react";
import { getJson } from "../api/client";

/** Loads `url` as JSON whenever it changes, a moment after the last change; null: nothing to load. */
export function useFetch<T>(url: string | null, attempt = 0): { data: T | null; loading: boolean; failed: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(url !== null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (url === null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    const timer = setTimeout(() => {
      getJson<T>(url)
        .then((d) => {
          setData(d);
          setLoading(false);
        })
        .catch(() => {
          setFailed(true);
          setLoading(false);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [url, attempt]);
  return { data, loading, failed };
}
