import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

/**
 * Shows its children to an owner only, on the API's word. The API refuses the data to anyone else as well: this is the
 * screen's convenience, not the protection.
 */
export function RequireOwner({ children }: { children: ReactNode }) {
  const location = useLocation();
  const role = localStorage.getItem("role");

  if (!role) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (role !== "owner") {
    return (
      <section className="page">
        <h1 className="page__title">Owners only</h1>
        <p className="page__subtitle">Billing is for the owners of the clinic.</p>
      </section>
    );
  }
  return <>{children}</>;
}
