import { useLoaderData } from "react-router";
import { Spinner } from "../ui/Spinner";
import { BillingPage } from "./BillingPage";
import type { SessionUser } from "./api";

export function OwnerGate() {
  const user = useLoaderData() as SessionUser;
  if (user.role !== "owner") {
    return (
      <section className="page">
        <h1 className="page__title">Owners only</h1>
      </section>
    );
  }
  return <BillingPage />;
}

export function CheckingAccess() {
  return <Spinner label="Checking your access…" />;
}
