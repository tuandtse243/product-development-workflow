import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Invite } from "../../shared/invites.ts";
import { inviteFieldErrors } from "./rules";
import { ApiError } from "../api/client";
import { sendInvite } from "./api";

const REASONS: Record<string, string> = {
  required: "This is required.",
  "too-long": "The name is too long: at most 80 characters.",
  invalid: "The email is not valid.",
};

/** The dialog that invites a person: the name and the email are checked with the shared rules before anything is sent. */
export function InviteDialog({ onClose, onInvited }: { onClose: () => void; onInvited: (invite: Invite) => void }) {
  const id = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const refused = inviteFieldErrors({ name, email });
    setFailure(null);
    setFields(refused ?? {});
    if (refused) return;
    setSaving(true);
    try {
      onInvited(await sendInvite({ name, email }));
    } catch (err) {
      setFailure(err instanceof ApiError && err.status === 403 ? "Only owners can invite people to the team." : "The invite could not be sent. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const field = (key: "name" | "email", label: string, value: string, set: (v: string) => void, ref?: React.Ref<HTMLInputElement>) => (
    <div>
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input
        id={`${id}-${key}`}
        ref={ref}
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-invalid={fields[key] ? "true" : undefined}
        aria-describedby={fields[key] ? `${id}-${key}-error` : undefined}
      />
      {fields[key] && <p id={`${id}-${key}-error`}>{REASONS[fields[key]!] ?? "This is not valid."}</p>}
    </div>
  );

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <h2 id={`${id}-title`}>Invite a member</h2>
      <form noValidate onSubmit={submit}>
        {field("name", "Name", name, setName, first)}
        {field("email", "Email", email, setEmail)}
        {failure && <p role="alert">{failure}</p>}
        <button type="submit" disabled={saving}>
          Send invite
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </div>
  );
}
