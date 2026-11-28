import { useEffect, useState } from "react";
import type { Invoice } from "../../shared/billing.ts";
import { ApiError } from "../api/client";
import { fetchInvoices } from "./api";

type State = { status: "loading" } | { status: "forbidden" } | { status: "error" } | { status: "ready"; invoices: Invoice[] };

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** `/billing`: what the team is billed, for its owners. */
export function BillingPage() {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    const ac = new AbortController();
    fetchInvoices(ac.signal).then(
      (invoices) => setState({ status: "ready", invoices }),
      (e: unknown) => {
        if (ac.signal.aborted) return;
        // The server's refusal of a member: the page says so and holds no invoice.
        setState(e instanceof ApiError && e.status === 403 ? { status: "forbidden" } : { status: "error" });
      },
    );
    return () => ac.abort();
  }, []);

  return (
    <section aria-labelledby="billing-title">
      <h1 id="billing-title">Billing</h1>
      {state.status === "loading" && <p role="status">Loading invoices...</p>}
      {state.status === "forbidden" && <p role="alert">Billing is for owners only.</p>}
      {state.status === "error" && <p role="alert">The invoices could not be loaded.</p>}
      {state.status === "ready" && state.invoices.length === 0 && <p>No invoices yet.</p>}
      {state.status === "ready" && state.invoices.length > 0 && (
        <table>
          <caption>Invoices</caption>
          <thead>
            <tr>
              <th scope="col">Number</th>
              <th scope="col">Amount</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {state.invoices.map((i) => (
              <tr key={i.id}>
                <td>{i.number}</td>
                <td>{money(i.amountCents)}</td>
                <td>{i.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
