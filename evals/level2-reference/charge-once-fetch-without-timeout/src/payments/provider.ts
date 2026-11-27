import type { Charge, ChargeRequest, PaymentGateway } from "../billing/gateway.ts";

/**
 * WRONG on purpose: an Agent's own adapter to the provider, next to the route, whose fetch has no timeout and no abort
 * signal (B12): a provider that stops answering holds the request, and the payment's key, for as long as the connection
 * stays open. The held-out tests install memoryGateway() and never reach it; only leak-and-timeout-scan sees it.
 */
export function directGateway(url: string, apiKey: string): PaymentGateway {
  return {
    async charge(req: ChargeRequest): Promise<Charge> {
      const res = await fetch(`${url}/v1/charges`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, "idempotency-key": req.idempotencyKey },
        body: JSON.stringify({ amount: req.amount, currency: req.currency, customer: req.customer }),
      });
      const body = (await res.json()) as { id: string };
      return { id: body.id, amount: req.amount, currency: req.currency };
    },
  };
}
