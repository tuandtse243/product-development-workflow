import type { Charge, ChargeRequest, PaymentGateway } from "../billing/gateway.ts";

/**
 * GAP: the same adapter as charge-once-fetch-without-timeout, with no timeout and no abort signal, but its fetch options
 * spread shared defaults. leak-and-timeout-scan cannot judge `fetch(url, { ...base, body })` (a documented limit: the
 * spread may carry a signal) and skips it, so no check of the case catches this missing timeout (B12).
 */
export function directGateway(url: string, apiKey: string): PaymentGateway {
  const base = { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` } };
  return {
    async charge(req: ChargeRequest): Promise<Charge> {
      const res = await fetch(`${url}/v1/charges`, { ...base, body: JSON.stringify({ amount: req.amount, currency: req.currency, customer: req.customer, key: req.idempotencyKey }) });
      const body = (await res.json()) as { id: string };
      return { id: body.id, amount: req.amount, currency: req.currency };
    },
  };
}
