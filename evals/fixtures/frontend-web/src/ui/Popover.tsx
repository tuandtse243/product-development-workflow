import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";

export interface PopoverProps {
  /** the visible text of the button that opens it (its accessible name) */
  label: string;
  children: ReactNode;
}

/**
 * A button that shows a panel below it (a disclosure: `aria-expanded`, `aria-controls`). Escape or a click outside closes
 * the panel and puts focus back on the button.
 */
export function Popover({ label, children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div className="popover" ref={root}>
      <Button ref={trigger} variant="quiet" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        {label}
      </Button>
      {open && (
        <div id={panelId} className="popover__panel">
          {children}
        </div>
      )}
    </div>
  );
}
