import { invoiceListSchema, type Invoice } from "../../shared/billing.ts";
import { getJson } from "../api/client";

/** The team's invoices (`GET /api/billing`). */
export async function fetchInvoices(signal?: AbortSignal): Promise<Invoice[]> {
  return invoiceListSchema.parse(await getJson("/api/billing", { signal })).items;
}
