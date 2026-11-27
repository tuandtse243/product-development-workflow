import { useEffect, useState } from "react";
import { formatDay } from "../format";
import { Spinner } from "../ui/Spinner";
import { getBilling, type Billing } from "./api";
import "./billing.css";

type Load = { status: "loading" } | { status: "failed" } | { status: "ready"; billing: Billing };

const money = (minor: number, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);

/** Stripe's test account has keys that start with pk_test_; the key is public by design. */
const inTestMode = (): boolean => String(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? "").startsWith("pk_test_");

/** The clinic's plan, the balance due and the next invoice. Only an owner gets here (RequireOwner). */
export function BillingPage() {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    const ac = new AbortController();
    getBilling(ac.signal)
      .then((billing) => {
        if (!ac.signal.aborted) setLoad({ status: "ready", billing });
      })
      .catch(() => {
        if (!ac.signal.aborted) setLoad({ status: "failed" });
      });
    return () => ac.abort();
  }, []);

  return (
    <section className="page">
      <h1 className="page__title">Billing</h1>
      {inTestMode() && <p className="billing__badge">Test mode</p>}
      {load.status === "loading" && <Spinner label="Loading billing…" />}
      {load.status === "failed" && <p role="alert">Could not load the billing.</p>}
      {load.status === "ready" && (
        <dl className="billing__summary">
          <dt>Plan</dt>
          <dd>{load.billing.plan}</dd>
          <dt>Balance due</dt>
          <dd>{money(load.billing.balanceDue, load.billing.currency)}</dd>
          <dt>Next invoice</dt>
          <dd>{formatDay(load.billing.nextInvoice)}</dd>
        </dl>
      )}
    </section>
  );
}
