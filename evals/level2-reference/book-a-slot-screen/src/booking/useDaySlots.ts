import { useCallback, useEffect, useState } from "react";
import { getDoctor, type Doctor } from "../api/doctors";
import { listSlots, type Slot } from "./api";

export type DaySlots =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; doctor: Doctor; slots: Slot[] };

/**
 * The doctor and the slots of one day, read together. A failed read is its own state (never an empty list); `retry`
 * reads again; `markBooked` shows a slot as booked once the API said so.
 */
export function useDaySlots(doctorId: string, date: string) {
  const [state, setState] = useState<DaySlots>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    setState({ status: "loading" });
    Promise.all([getDoctor(doctorId, ac.signal), listSlots(doctorId, date, ac.signal)])
      .then(([doctor, slots]) => {
        if (!ac.signal.aborted) setState({ status: "ready", doctor, slots });
      })
      .catch(() => {
        if (!ac.signal.aborted) setState({ status: "error" });
      });
    return () => ac.abort();
  }, [doctorId, date, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const markBooked = useCallback((slotId: string) => {
    setState((s) => (s.status === "ready" ? { ...s, slots: s.slots.map((x) => (x.id === slotId ? { ...x, booked: true } : x)) } : s));
  }, []);
  return { state, retry, markBooked };
}
