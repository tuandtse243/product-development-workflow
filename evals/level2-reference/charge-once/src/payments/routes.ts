import { Router } from "express";
import { z } from "zod";
import { paymentGateway } from "../billing/gateway.ts";
import type { Db } from "../db/client.ts";
import { HttpError } from "../http/errors.ts";
import { requireSession } from "../http/session.ts";
import { parse } from "../http/validate.ts";
import { invoiceOfMember, payInvoice } from "./repo.ts";

const Params = z.object({ invoiceId: z.string().uuid() });
const KEY = /^[\x21-\x7E]{1,255}$/;
const Body = z.object({ amount: z.number().int().min(1).max(10_000_000) }).strict();

/** POST /api/invoices/:invoiceId/payments: charges the team's card for an invoice, once per Idempotency-Key of the caller. */
export function paymentRoutes(db: Db): Router {
  const r = Router();
  r.post("/api/invoices/:invoiceId/payments", requireSession(db), async (req, res) => {
    const callerId = req.session!.userId;
    const params = Params.safeParse(req.params);
    const invoice = params.success ? await invoiceOfMember(db, params.data.invoiceId, callerId) : null;
    if (!invoice) throw new HttpError(404, "invoice-not-found", "No such invoice");
    const key = req.header("idempotency-key");
    if (!key || !KEY.test(key)) throw new HttpError(400, "idempotency-key-missing", "Send an Idempotency-Key");
    const body = parse(Body, req.body);
    const out = await payInvoice(db, paymentGateway(), { callerId, key, invoice, amount: body.amount });
    switch (out.kind) {
      case "reused":
        throw new HttpError(422, "idempotency-key-reused", "This key was used for another request");
      case "in-progress":
        throw new HttpError(409, "request-in-progress", "A request with this key is still running");
      case "unavailable":
        throw new HttpError(502, "payment-provider-unavailable", "The payment provider did not answer");
      case "done":
        if (out.status === 402) throw new HttpError(402, "payment-declined", "The card was declined");
        res.status(out.status).json(out.body);
    }
  });
  return r;
}
