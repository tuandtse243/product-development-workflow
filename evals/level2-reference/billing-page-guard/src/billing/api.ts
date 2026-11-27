import { getJson } from "../api/client";

export interface SessionUser {
  id: string;
  name: string;
  role: "member" | "owner";
}

/** The clinic's billing summary, as GET /api/billing answers it (the balance in minor units). */
export interface Billing {
  plan: string;
  balanceDue: number;
  currency: string;
  /** `YYYY-MM-DD` */
  nextInvoice: string;
}

export const getSession = (signal?: AbortSignal) => getJson<{ user: SessionUser }>("/api/session", { signal });

export const getBilling = (signal?: AbortSignal) => getJson<Billing>("/api/billing", { signal });
