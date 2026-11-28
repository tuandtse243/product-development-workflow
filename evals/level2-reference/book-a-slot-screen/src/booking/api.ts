import { getJson, postJson } from "../api/client";

/** A slot of a doctor's day, as GET /api/doctors/{doctorId}/days/{date}/slots answers it. */
export interface Slot {
  id: string;
  /** `HH:MM`, the clinic's local time */
  time: string;
  booked: boolean;
}

export interface Booking {
  id: string;
  slotId: string;
}

export const listSlots = (doctorId: string, date: string, signal?: AbortSignal) =>
  getJson<Slot[]>(`/api/doctors/${encodeURIComponent(doctorId)}/days/${encodeURIComponent(date)}/slots`, { signal });

export const bookSlot = (slotId: string) => postJson<Booking>("/api/bookings", { slotId });
