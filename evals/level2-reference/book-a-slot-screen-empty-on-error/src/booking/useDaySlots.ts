import { useCallback, useState } from "react";
import { getDoctor, type Doctor } from "../api/doctors";
import { useLoad } from "../data/useLoad";
import { listSlots, type Slot } from "./api";

export type DaySlots =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; doctor: Doctor; slots: Slot[] };

/**
 * Wrong on purpose (copies the project's useLoad): a failed read becomes an empty list, so the screen shows "No open
 * slots" when the request failed, and there is nothing to retry.
 */
export function useDaySlots(doctorId: string, date: string) {
  const [booked, setBooked] = useState<string[]>([]);
  const doctor = useLoad<Doctor>((signal) => getDoctor(doctorId, signal), [doctorId], { id: doctorId, name: "", specialty: "" });
  const slots = useLoad<Slot[]>((signal) => listSlots(doctorId, date, signal), [doctorId, date], []);
  const state = (
    doctor.loading || slots.loading
      ? { status: "loading" }
      : { status: "ready", doctor: doctor.data, slots: slots.data.map((s) => (booked.includes(s.id) ? { ...s, booked: true } : s)) }
  ) as DaySlots;
  const retry = useCallback(() => {}, []);
  const markBooked = useCallback((slotId: string) => setBooked((b) => [...b, slotId]), []);
  return { state, retry, markBooked };
}
