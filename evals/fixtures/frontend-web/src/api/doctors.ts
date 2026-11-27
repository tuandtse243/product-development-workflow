import { getJson } from "./client";

export interface Doctor {
  id: string;
  name: string;
  specialty: string;
}

/** A day of a doctor's calendar and how many of its slots are still open. */
export interface Day {
  /** `YYYY-MM-DD` */
  date: string;
  openSlots: number;
}

export const listDoctors = (signal?: AbortSignal) => getJson<Doctor[]>("/api/doctors", { signal });

export const getDoctor = (doctorId: string, signal?: AbortSignal) => getJson<Doctor>(`/api/doctors/${encodeURIComponent(doctorId)}`, { signal });

export const listDays = (doctorId: string, signal?: AbortSignal) => getJson<Day[]>(`/api/doctors/${encodeURIComponent(doctorId)}/days`, { signal });
