import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ApiError } from "../api/client";
import { formatDay } from "../format";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Spinner } from "../ui/Spinner";
import { bookSlot, type Slot } from "./api";
import { SlotList } from "./SlotList";
import { useDaySlots } from "./useDaySlots";
import "./booking.css";

type Pending = { slot: Slot; sending: boolean; problem: "taken" | "failed" | null };

/** The slots of one day of a doctor; picking an open slot asks to confirm the booking in a dialog. */
export function BookSlotScreen() {
  const { doctorId = "", date = "" } = useParams();
  const { state, retry, markBooked } = useDaySlots(doctorId, date);
  const [pending, setPending] = useState<Pending | null>(null);
  // Wrong on purpose (trusts the shared Dialog): nothing puts focus back on the slot when the dialog closes.
  const opener = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const close = () => {
    setPending(null);
    opener.current = null;
  };

  const confirm = async () => {
    if (!pending || pending.sending) return;
    const { slot } = pending;
    setPending({ slot, sending: true, problem: null });
    try {
      await bookSlot(slot.id);
      markBooked(slot.id);
      setPending(null);
      opener.current = null;
      heading.current?.focus();
    } catch (e) {
      const taken = e instanceof ApiError && e.status === 409;
      if (taken) markBooked(slot.id);
      setPending({ slot, sending: false, problem: taken ? "taken" : "failed" });
    }
  };

  const doctorName = state.status === "ready" ? state.doctor.name : "";
  return (
    <section className="page">
      <p>
        <Link to={`/doctors/${encodeURIComponent(doctorId)}`}>Other days</Link>
      </p>
      <h1 className="page__title booking__title" ref={heading} tabIndex={-1}>
        {doctorName ? `${doctorName}, ${formatDay(date)}` : formatDay(date)}
      </h1>
      {state.status === "loading" && <Spinner label="Loading slots…" />}
      {state.status === "error" && (
        <div role="alert" className="booking__error">
          <p>Could not load the slots of this day.</p>
          <Button onClick={retry}>Retry</Button>
        </div>
      )}
      {state.status === "ready" &&
        (state.slots.length ? (
          <SlotList
            slots={state.slots}
            onPick={(slot, el) => {
              opener.current = el;
              setPending({ slot, sending: false, problem: null });
            }}
          />
        ) : (
          <p className="empty">No open slots on this day.</p>
        ))}
      <Dialog open={pending !== null} title={pending ? `Book ${pending.slot.time} with ${doctorName}` : ""} onClose={close}>
        {pending && (
          <>
            <p>{formatDay(date)}</p>
            {pending.problem === "taken" && (
              <p role="alert" className="booking__error">
                Someone has just booked {pending.slot.time}. Pick another slot.
              </p>
            )}
            {pending.problem === "failed" && (
              <p role="alert" className="booking__error">
                Could not book {pending.slot.time}. Try again.
              </p>
            )}
            <div className="booking__actions">
              {pending.problem !== "taken" && (
                <Button variant="primary" onClick={confirm} disabled={pending.sending}>
                  {pending.sending ? "Booking…" : "Confirm booking"}
                </Button>
              )}
              <Button onClick={close}>{pending.problem === "taken" ? "Close" : "Cancel"}</Button>
            </div>
          </>
        )}
      </Dialog>
    </section>
  );
}
