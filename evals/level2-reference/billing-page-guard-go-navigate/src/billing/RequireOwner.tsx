import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { ApiError } from "../api/client";
import { getSession } from "./api";

type Verdict = "unknown" | "owner" | "member" | "nobody" | "error";

/** The same guard written as an effect that decides once and redirects with navigate(). */
export function RequireOwner({ children }: { children: ReactNode }) {
  const go = useNavigate();
  const { pathname } = useLocation();
  const [verdict, setVerdict] = useState<Verdict>("unknown");

  useEffect(() => {
    let live = true;
    getSession().then(
      ({ user }) => live && setVerdict(user.role === "owner" ? "owner" : "member"),
      (e) => live && setVerdict(e instanceof ApiError && e.status === 401 ? "nobody" : "error"),
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (verdict === "nobody") go({ pathname: "/login", search: `?next=${pathname}` }, { replace: true });
  }, [verdict, go, pathname]);

  if (verdict === "owner") return <>{children}</>;
  if (verdict === "member") {
    return (
      <section className="page">
        <h1 className="page__title">Owners only</h1>
      </section>
    );
  }
  if (verdict === "error") return <p role="alert">We could not verify your access. Reload the page to try again.</p>;
  return <p role="status">Verifying your access…</p>;
}
