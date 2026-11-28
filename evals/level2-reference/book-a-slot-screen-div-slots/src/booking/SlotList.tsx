import type { Slot } from "./api";
import { Icon } from "../ui/Icon";

export interface SlotListProps {
  slots: Slot[];
  onPick: (slot: Slot, opener: HTMLButtonElement) => void;
}

/** Wrong on purpose (copies DayList): each slot is a <div onClick> with its icon named by its raw key. */
export function SlotList({ slots, onPick }: SlotListProps) {
  return (
    <div className="slot-list">
      {slots.map((slot) =>
        slot.booked ? (
          <div key={slot.id} className="slot slot--booked">
            <Icon name="icon-check" label="icon-check" />
            {slot.time} <span className="slot__state">Booked</span>
          </div>
        ) : (
          <div key={slot.id} className="slot" onClick={(e) => onPick(slot, e.currentTarget as unknown as HTMLButtonElement)}>
            <Icon name="icon-clock" label="icon-clock" />
            {slot.time}
          </div>
        ),
      )}
    </div>
  );
}
