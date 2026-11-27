import type { Slot } from "./api";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

export interface SlotListProps {
  slots: Slot[];
  onPick: (slot: Slot, opener: HTMLButtonElement) => void;
}

/** The slots of a day: an open one is a button named by its time; a booked one shows its time and "Booked". */
export function SlotList({ slots, onPick }: SlotListProps) {
  return (
    <ul className="slot-list">
      {slots.map((slot) => (
        <li key={slot.id}>
          {slot.booked ? (
            <span className="slot slot--booked">
              <Icon name="icon-check" />
              {slot.time} <span className="slot__state">Booked</span>
            </span>
          ) : (
            <Button className="slot" aria-haspopup="dialog" onClick={(e) => onPick(slot, e.currentTarget)}>
              <Icon name="icon-clock" label="icon-clock" />
              {slot.time}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
