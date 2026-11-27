import { useState, type FormEvent } from "react";
import { ApiError, postJson } from "../api/client";
import { Button } from "../ui/Button";
import "./contact.css";

/** A message to the front desk. Whatever the answer, it is told in a toast under the form. */
export function ContactPage() {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [toast, setToast] = useState("");

  async function send(e: FormEvent) {
    e.preventDefault();
    try {
      await postJson("/api/messages", { name, message });
      setToast("Message sent");
      setName("");
      setMessage("");
    } catch (err) {
      setToast(err instanceof ApiError ? err.message : "Could not send");
    }
  }

  return (
    <section className="page">
      <h1 className="page__title">Contact the front desk</h1>
      <form className="contact__form" onSubmit={send}>
        <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <textarea placeholder="Message" value={message} onChange={(e) => setMessage(e.target.value)} />
        <Button type="submit" variant="primary">
          Send
        </Button>
      </form>
      {toast && <p className="contact__toast">{toast}</p>}
    </section>
  );
}
