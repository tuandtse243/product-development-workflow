import type { Day } from "../api/doctors";
import { formatDay } from "../format";
import { Icon } from "../ui/Icon";
import "./doctors.css";

export interface DayListProps {
  days: Day[];
  onPick: (date: string) => void;
  onMore?: () => void;
}

/** The days of a doctor's calendar; picking one opens its slots. */
export function DayList({ days, onPick, onMore }: DayListProps) {
  return (
    <div className="day-list">
      {days.map((day) => (
        <div key={day.date} className={day.openSlots ? "day" : "day day--full"} onClick={() => onPick(day.date)}>
          <Icon name={day.openSlots ? "icon-calendar" : "icon-calendar-off"} label={day.openSlots ? "icon-calendar" : "icon-calendar-off"} />
          <span className="day__date">{formatDay(day.date)}</span>
          <span className="day__open">{day.openSlots} open</span>
        </div>
      ))}
      {onMore && (
        <div className="day-list__more" onClick={onMore}>
          <Icon name="icon-chevron-right" label="icon-chevron-right" />
        </div>
      )}
    </div>
  );
}
