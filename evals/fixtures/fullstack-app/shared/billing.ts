import { z } from "zod";

/**
 * An invoice as the API sends it, and the list. Imported by `server/` and `web/`, so nothing here may import the database,
 * Express or any other server-only module.
 */
export const invoiceSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  number: z.string(),
  amountCents: z.number().int(),
  status: z.enum(["open", "paid"]),
  issuedAt: z.string(),
});
export type Invoice = z.infer<typeof invoiceSchema>;

export const invoiceListSchema = z.object({ items: z.array(invoiceSchema) });
export type InvoiceList = z.infer<typeof invoiceListSchema>;
