import { useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { Button } from "../ui/Button";
import { fieldErrorsOf, sendInvitation, type FieldError } from "./api";
import "./team.css";

const NAME_MAX = 80;
type Errors = Partial<Record<FieldError["field"], string>>;
type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; email: string } | { kind: "failed" };

/** What the contract refuses, checked before sending; the API still decides. */
function check(name: string, email: string): Errors {
  const errors: Errors = {};
  if (!name.trim()) errors.name = "Enter a name.";
  else if (name.length > NAME_MAX) errors.name = `Name is at most ${NAME_MAX} characters.`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter an email address.";
  return errors;
}

/** Invites a colleague by name and email; each error is shown next to its field. */
export function InviteForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const busy = useRef(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    const found = check(name, email);
    setErrors(found);
    if (found.name || found.email) return;
    busy.current = true;
    setStatus({ kind: "sending" });
    try {
      await sendInvitation({ name, email });
      setStatus({ kind: "sent", email });
      setName("");
      setEmail("");
    } catch (err) {
      const fields = err instanceof ApiError && err.status === 422 ? fieldErrorsOf(err.body) : [];
      if (fields.length) {
        setErrors(Object.fromEntries(fields.map((f) => [f.field, f.message])));
        setStatus({ kind: "idle" });
      } else {
        setStatus({ kind: "failed" });
      }
    } finally {
      busy.current = false;
    }
  }

  const sending = status.kind === "sending";
  return (
    <section className="page">
      <h1 className="page__title">Invite a person</h1>
      <form className="team__form" onSubmit={submit} noValidate>
        <label htmlFor="invite-name">Name</label>
        <input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="invite-email">Email</label>
        <input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" variant="primary" disabled={sending}>
          Send invitation
        </Button>
      </form>
      {(errors.name || errors.email) && <p role="status" className="team__error">{[errors.name, errors.email].filter(Boolean).join(" ")}</p>}
      {status.kind === "sent" && <p role="status">Invitation sent to {status.email}.</p>}
      {status.kind === "failed" && <p role="alert" className="team__error">The invitation could not be sent. Try again.</p>}
    </section>
  );
}
