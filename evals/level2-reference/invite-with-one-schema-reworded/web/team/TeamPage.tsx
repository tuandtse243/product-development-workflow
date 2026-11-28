import { useRef, useState } from "react";
import type { Invite } from "../../shared/invites.ts";
import { InviteDialog } from "./InviteDialog";

/** `/team`: invite a person to the team. */
export function TeamPage() {
  const [open, setOpen] = useState(false);
  const [invited, setInvited] = useState<Invite | null>(null);
  const opener = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    queueMicrotask(() => opener.current?.focus());
  };

  return (
    <section aria-labelledby="team-title">
      <h1 id="team-title">Team</h1>
      {invited && <p role="status">Added {invited.name} to the team.</p>}
      <button type="button" ref={opener} onClick={() => setOpen(true)}>
        Add a person
      </button>
      {open && (
        <InviteDialog
          onClose={close}
          onInvited={(invite) => {
            setInvited(invite);
            close();
          }}
        />
      )}
    </section>
  );
}
