import { useReducer, useRef } from "react";
import { ApiError } from "../api/client";
import { fieldErrorsOf, sendInvitation } from "./api";
import "./team.css";

interface State {
  name: string;
  email: string;
  problems: { name?: string; email?: string };
  outcome: "none" | "sent" | "failed";
  lastEmail: string;
}
type Action = { set: "name" | "email"; value: string } | { problems: State["problems"] } | { outcome: "sent" | "failed" | "none" };

const start: State = { name: "", email: "", problems: {}, outcome: "none", lastEmail: "" };

function reduce(s: State, a: Action): State {
  if ("set" in a) return { ...s, [a.set]: a.value };
  if ("problems" in a) return { ...s, problems: a.problems, outcome: "none" };
  if (a.outcome === "sent") return { ...start, outcome: "sent", lastEmail: s.email };
  return { ...s, outcome: a.outcome, problems: {} };
}

/** The same form with the state in a reducer, the labels wrapping their inputs and the double submit stopped by a ref. */
export function InviteForm() {
  const [s, dispatch] = useReducer(reduce, start);
  const inFlight = useRef(false);

  const submit = async (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (inFlight.current) return;
    const problems: State["problems"] = {};
    if (s.name.trim().length === 0) problems.name = "The name cannot be empty.";
    if (s.name.length > 80) problems.name = "Use at most 80 characters for the name.";
    if (Object.keys(problems).length) return dispatch({ problems });
    inFlight.current = true;
    try {
      await sendInvitation({ name: s.name, email: s.email });
      dispatch({ outcome: "sent" });
    } catch (err) {
      const list = err instanceof ApiError && err.status === 422 ? fieldErrorsOf(err.body) : [];
      if (list.length) dispatch({ problems: Object.fromEntries(list.map((f) => [f.field, f.message])) });
      else dispatch({ outcome: "failed" });
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <section className="page">
      <h1 className="page__title">Invite a colleague</h1>
      <form className="team__form" onSubmit={submit} noValidate>
        <label>
          Full name
          <input value={s.name} onChange={(e) => dispatch({ set: "name", value: e.target.value })} aria-invalid={!!s.problems.name} aria-describedby="why-name" />
        </label>
        <span id="why-name" className="team__error">
          {s.problems.name}
        </span>
        <label>
          Work email
          <input type="email" value={s.email} onChange={(e) => dispatch({ set: "email", value: e.target.value })} aria-invalid={!!s.problems.email} aria-describedby="why-email" />
        </label>
        <span id="why-email" className="team__error">
          {s.problems.email}
        </span>
        <button type="submit">Send invitation</button>
      </form>
      {s.outcome === "sent" && <div role="status">Invitation sent: {s.lastEmail}</div>}
      {s.outcome === "failed" && <div role="alert">We could not send it. Please try once more.</div>}
    </section>
  );
}
