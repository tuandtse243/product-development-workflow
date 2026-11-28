import { useEffect, useState } from "react";
import { getJson } from "../api/client";

/**
 * Loads `url` as JSON whenever it changes: `data` is null until the first answer, `loading` is true while a request is
 * out, `failed` is true when the last one failed.
 */
export function useFetch<T>(url: string): { data: T | null; loading: boolean; failed: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setLoading(true);
    setFailed(false);
    getJson<T>(url)
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        setFailed(true);
        setLoading(false);
      });
  }, [url]);
  return { data, loading, failed };
}
