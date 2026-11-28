import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { useSession } from "./useSession";

/**
 * Shows its children to an owner only, on the API's word. The API refuses the data to anyone else as well: this is the
 * screen's convenience, not the protection.
 */
export function RequireOwner({ children }: { children: ReactNode }) {
  const { session, retry } = useSession();

  if (session.status === "checking") return <Spinner label="Checking your access…" />;
  if (session.status === "signed-out") return <Navigate to={"/login"} replace />;
  if (session.status === "failed") {
    return (
      <div role="alert" className="billing__notice">
        <p>Could not check your access.</p>
        <Button onClick={retry}>Retry</Button>
      </div>
    );
  }
  if (session.user.role !== "owner") {
    return (
      <section className="page">
        <h1 className="page__title">Owners only</h1>
        <p className="page__subtitle">Billing is for the owners of the clinic. Ask an owner if you need something from it.</p>
      </section>
    );
  }
  return <>{children}</>;
}
