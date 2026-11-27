/**
 * The adapter to the payment provider. Code charges a card only through `PaymentGateway`, taken from
 * `paymentGateway()` when a request needs it; `src/server.ts` installs the HTTP adapter, and tests install
 * `memoryGateway()` with `usePaymentGateway()`, so no test talks to the real provider.
 */
export interface ChargeRequest {
  /** cents */
  amount: number;
  currency: string;
  /** the customer at the provider whose saved card is charged (`invoices.customer_ref`) */
  customer: string;
  /**
   * The provider charges once per key: a second call with a key it has seen returns the first charge and charges
   * nothing. Required: a call that times out may have charged.
   */
  idempotencyKey: string;
}

export interface Charge {
  /** the provider's id of the charge */
  id: string;
  amount: number;
  currency: string;
}

/**
 * `declined`: the provider refused the card; calling again changes nothing. `unavailable`: no answer (a timeout, a
 * connection error, 429 or 5xx after the adapter's own retries); the charge may or may not have happened, and calling
 * again with the same idempotency key is safe. Any other error is a bug (an unexpected error).
 */
export class GatewayError extends Error {
  readonly kind: "declined" | "unavailable";
  constructor(kind: "declined" | "unavailable", message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface PaymentGateway {
  charge(req: ChargeRequest): Promise<Charge>;
}

let installed: PaymentGateway | null = null;

/** Sets the gateway every later `paymentGateway()` returns (the server at start, a test before it sends requests). */
export function usePaymentGateway(g: PaymentGateway): void {
  installed = g;
}

/** The installed gateway; throws when none was installed. */
export function paymentGateway(): PaymentGateway {
  if (!installed) throw new Error("no payment gateway installed: call usePaymentGateway() first");
  return installed;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The provider's HTTP API. Each call has a 10 s timeout; a timeout, a connection error, 429 or 5xx is retried twice
 * with backoff and the same idempotency key, then reported as `unavailable`. A caller does not retry on its own.
 */
export function httpGateway(o: { url: string; apiKey: string; timeoutMs?: number }): PaymentGateway {
  return {
    async charge(req) {
      for (let attempt = 1; ; attempt++) {
        let status = 0;
        try {
          const res = await fetch(`${o.url}/v1/charges`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}`, "idempotency-key": req.idempotencyKey },
            body: JSON.stringify({ amount: req.amount, currency: req.currency, customer: req.customer }),
            signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
          });
          status = res.status;
          if (res.ok) {
            const body = (await res.json()) as { id: string };
            return { id: body.id, amount: req.amount, currency: req.currency };
          }
          if (status === 402) throw new GatewayError("declined", "the card was declined");
        } catch (err) {
          if (err instanceof GatewayError) throw err;
        }
        // Any other 4xx: the request itself is wrong, a bug of ours and not the provider's state.
        if (status && status < 500 && status !== 429) throw new Error(`the payment provider refused the request: ${status}`);
        if (attempt === 3) throw new GatewayError("unavailable", status ? `the provider answered ${status}` : "the provider did not answer");
        await sleep(200 * 2 ** attempt);
      }
    },
  };
}

/**
 * A fake provider for tests. `calls` keeps every call; `charges` what it charged, one per idempotency key, as the real
 * one does. `failWith` makes the next calls throw; `hold()` makes the next calls wait until the function it returns is
 * called (to have a request still running while another arrives).
 */
export function memoryGateway(): PaymentGateway & {
  calls: ChargeRequest[];
  charges: Map<string, Charge>;
  failWith: GatewayError | null;
  hold(): () => void;
} {
  let held: Promise<void> | null = null;
  const g = {
    calls: [] as ChargeRequest[],
    charges: new Map<string, Charge>(),
    failWith: null as GatewayError | null,
    hold() {
      let release!: () => void;
      held = new Promise<void>((r) => (release = r));
      return () => {
        held = null;
        release();
      };
    },
    async charge(req: ChargeRequest): Promise<Charge> {
      g.calls.push({ ...req });
      if (held) await held;
      if (g.failWith) throw g.failWith;
      const seen = g.charges.get(req.idempotencyKey);
      if (seen) return seen;
      const c = { id: `ch_${g.charges.size + 1}`, amount: req.amount, currency: req.currency };
      g.charges.set(req.idempotencyKey, c);
      return c;
    },
  };
  return g;
}
